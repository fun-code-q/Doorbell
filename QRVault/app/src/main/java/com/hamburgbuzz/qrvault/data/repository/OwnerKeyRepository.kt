package com.hamburgbuzz.qrvault.data.repository

import com.hamburgbuzz.qrvault.data.crypto.Sodium
import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Publishes this device's libsodium Curve25519 public key so guests can
 * encrypt their messages to the owner. Idempotent — the underlying RPC
 * uses ON CONFLICT (user_id, house_id, public_key) DO UPDATE.
 *
 * Call sites:
 *   * after sign-in
 *   * after creating a new house (publishes against the active house id)
 */
@Singleton
class OwnerKeyRepository @Inject constructor(
    private val supabase: SupabaseClient,
    private val sodium: Sodium,
) {
    suspend fun publishPublicKeyFor(
        houseId: String,
        deviceLabel: String? = null,
    ): Outcome<Unit> = runCatchingOutcome {
        val kp = sodium.keypair()
        supabase.postgrest.rpc(
            "publish_owner_public_key",
            buildJsonObject {
                put("p_house_id",    JsonPrimitive(houseId))
                put("p_public_key",  JsonPrimitive(kp.publicKey))
                deviceLabel?.let { put("p_device_label", JsonPrimitive(it)) }
            }
        )
        Unit
    }

    /** Wipe the local keypair on sign-out. Forces a fresh key on next login. */
    fun rotateLocal() = sodium.rotate()
}
