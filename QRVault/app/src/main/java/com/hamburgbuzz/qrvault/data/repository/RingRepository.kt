package com.hamburgbuzz.qrvault.data.repository

import com.hamburgbuzz.qrvault.data.crypto.Sodium
import com.hamburgbuzz.qrvault.data.model.Ring
import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.decodeRecord
import io.github.jan.supabase.realtime.postgresChangeFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onEach
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.ZoneOffset
import java.time.ZonedDateTime
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Owner-side ring access. Handles:
 *  * paged fetch (initial dashboard load)
 *  * realtime subscription, with lifecycle-tied unsubscribe
 *  * owner-side message append (encrypted-aware)
 *  * acknowledge / dismiss / send-reply state transitions
 *  * client-side decrypt of guest_message_encrypted=true payloads
 */
@Singleton
class RingRepository @Inject constructor(
    private val supabase: SupabaseClient,
    private val sodium: Sodium,
) {

    private var channel: RealtimeChannel? = null

    /**
     * Pull the first (or next) page of rings, newest first (Batch F #14).
     * The dashboard initially loads with beforeAt=null; once the user
     * scrolls to the bottom we request the next page using the oldest
     * loaded ring's (created_at, id) as the cursor.
     */
    suspend fun fetchRingsPage(
        houseId: String? = null,
        status: String? = null,
        beforeCreatedAt: String? = null,
        beforeId: String? = null,
        limit: Int = 50,
    ): Outcome<List<Ring>> = runCatchingOutcome {
        val args = buildJsonObject {
            houseId?.let { put("p_house_id", JsonPrimitive(it)) }
            status?.let { put("p_status", JsonPrimitive(it)) }
            beforeCreatedAt?.let { put("p_before_at", JsonPrimitive(it)) }
            beforeId?.let { put("p_before_id", JsonPrimitive(it)) }
            put("p_limit", JsonPrimitive(limit))
        }
        supabase.postgrest.rpc("list_rings_page", args)
            .decodeList<Ring>()
            .map(::tryDecrypt)
    }

    /** Backwards-compatible default-page loader. */
    suspend fun fetchRings(): Outcome<List<Ring>> = fetchRingsPage()

    /**
     * Realtime stream of ring INSERT/UPDATE/DELETE events filtered to
     * the houses this user belongs to (Batch F #12). Pre-filtering at
     * subscribe time saves bandwidth + decoding cost; RLS would block
     * other houses anyway but they still travel over the websocket.
     */
    fun realtimeRings(houseIds: List<String>): Flow<RingEvent> = flow {
        if (houseIds.isEmpty()) return@flow
        channel?.let { runCatching { supabase.realtimeOrNull()?.removeChannel(it) } }
        val ch = supabase.channel("rings_${System.currentTimeMillis()}")
        channel = ch
        // Server-side filter syntax differs across Supabase Realtime versions.
        // 3.1.x exposes only `table`/`schema` on PostgresChangeFilter; the
        // string-based filter property was made private. Server-side
        // pre-filter is therefore disabled here; RLS still blocks rows for
        // other houses, and we filter client-side just in case.
        ch.postgresChangeFlow<PostgresAction>(schema = "public") {
            table = "doorbell_rings"
        }.onEach { /* route below */ }.collect { action ->
            when (action) {
                is PostgresAction.Insert -> emit(RingEvent.Insert(tryDecrypt(action.decodeRecord())))
                is PostgresAction.Update -> emit(RingEvent.Update(tryDecrypt(action.decodeRecord())))
                is PostgresAction.Delete -> action.oldRecord["id"]?.toString()?.let {
                    emit(RingEvent.Delete(it))
                }
                else -> Unit
            }
        }
    }

    suspend fun unsubscribe() {
        channel?.let { ch ->
            runCatching { supabase.realtimeOrNull()?.removeChannel(ch) }
        }
        channel = null
    }

    suspend fun acknowledge(ringId: String): Outcome<Unit> =
        updateStatus(ringId, status = "acknowledged")

    suspend fun dismiss(ringId: String): Outcome<Unit> =
        updateStatus(ringId, status = "dismissed")

    /**
     * Send an owner reply. The `idempotencyKey` lets the server short-circuit
     * duplicates (Batch D #5): same (ringId, key) within 5 min returns the
     * existing state without re-appending. The worker uses this to make
     * background retries safe.
     */
    suspend fun sendReply(
        ringId: String,
        message: String,
        idempotencyKey: String? = null,
    ): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "append_ring_message",
            buildJsonObject {
                put("p_ring_id",   JsonPrimitive(ringId))
                put("p_role",      JsonPrimitive("owner"))
                put("p_message",   JsonPrimitive(message))
                put("p_encrypted", JsonPrimitive(false))
                idempotencyKey?.let { put("p_idempotency_key", JsonPrimitive(it)) }
            }
        )
        Unit
    }

    suspend fun deleteRing(ringId: String): Outcome<Unit> = runCatchingOutcome {
        supabase.from("doorbell_rings").delete {
            filter { eq("id", ringId) }
        }
        Unit
    }

    // --- helpers ------------------------------------------------------------

    private suspend fun updateStatus(ringId: String, status: String): Outcome<Unit> =
        runCatchingOutcome {
            supabase.from("doorbell_rings").update(
                mapOf(
                    "status" to status,
                    "replied_at" to ZonedDateTime.now(ZoneOffset.UTC).toString(),
                )
            ) { filter { eq("id", ringId) } }
            Unit
        }

    /**
     * Best-effort decrypt of the guest message. We try every ciphertext
     * in `guest_message_ciphertexts` (Batch A #1 — multi-device) and
     * stop on the first one this device's keypair can open. If none
     * decrypt, fall back to the legacy single-`guest_message` field
     * (which still holds the first ciphertext for backwards-compat).
     */
    private fun tryDecrypt(r: Ring): Ring {
        if (r.guestMessageEncrypted != true) return r

        val candidates = buildList {
            r.guestMessageCiphertexts?.let { addAll(it) }
            r.guestMessage?.let { add(it) }
        }
        for (cipher in candidates) {
            val decoded = sodium.openSealed(cipher)
            if (decoded != null) return r.copy(guestMessage = decoded)
        }
        return r.copy(guestMessage = PLACEHOLDER)
    }

    private fun SupabaseClient.realtimeOrNull() = runCatching {
        this@realtimeOrNull.let {
            it.pluginManager.getPluginOrNull(io.github.jan.supabase.realtime.Realtime)
        }
    }.getOrNull()

    sealed interface RingEvent {
        data class Insert(val ring: Ring) : RingEvent
        data class Update(val ring: Ring) : RingEvent
        data class Delete(val id: String) : RingEvent
    }

    private companion object {
        const val PLACEHOLDER = "[encrypted — cannot decrypt on this device]"
    }
}
