package com.hamburgbuzz.qrvault.data.repository

import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Per-house outbound webhooks (Batch N #8) — IFTTT/Zapier/Home-Assistant
 * style integrations. Each row is a URL + HMAC secret; on every ring
 * INSERT the database trigger POSTs the signed payload there.
 *
 * The Edge Function `dispatch_outbound_webhooks` trigger runs server-side
 * — we only manage CRUD here.
 */
@Singleton
class WebhookRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {
    @Serializable
    data class Webhook(
        val id: String? = null,
        @SerialName("house_id")  val houseId: String,
        val url: String,
        val secret: String,
        val description: String? = null,
        @SerialName("is_active") val isActive: Boolean = true,
        @SerialName("on_events") val onEvents: String = "ring_created",
        @SerialName("created_at") val createdAt: String? = null,
    )

    suspend fun list(houseId: String): Outcome<List<Webhook>> = runCatchingOutcome {
        supabase.from("outbound_webhooks").select {
            filter { eq("house_id", houseId) }
        }.decodeList()
    }

    suspend fun create(
        houseId: String,
        url: String,
        secret: String,
        description: String?,
    ): Outcome<Unit> = runCatchingOutcome {
        supabase.from("outbound_webhooks").insert(
            Webhook(houseId = houseId, url = url, secret = secret, description = description)
        )
        Unit
    }

    suspend fun setActive(id: String, isActive: Boolean): Outcome<Unit> = runCatchingOutcome {
        supabase.from("outbound_webhooks").update(mapOf("is_active" to isActive)) {
            filter { eq("id", id) }
        }
        Unit
    }

    suspend fun delete(id: String): Outcome<Unit> = runCatchingOutcome {
        supabase.from("outbound_webhooks").delete { filter { eq("id", id) } }
        Unit
    }
}
