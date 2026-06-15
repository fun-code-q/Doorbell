package com.hamburgbuzz.qrvault.data.repository

import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Uploads / deactivates the device's FCM token via the
 * `register_push_token` and `deactivate_push_token` RPCs. The previous
 * schema's UPSERT-by-token allowed cross-user token hijack; the new
 * schema keys (user_id, fcm_token) and the RPC deactivates the same
 * token under any other user_id, so a stolen token cannot remain dual-claimed.
 */
@Singleton
class PushRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {
    suspend fun registerToken(
        token: String,
        platform: String = "android",
        houseId: String? = null,
        deviceLabel: String? = null,
        appVersion: String? = null,
    ): Outcome<Unit> = runCatchingOutcome {
        val params = buildJsonObject {
            put("p_token", JsonPrimitive(token))
            put("p_platform", JsonPrimitive(platform))
            houseId?.let { put("p_house_id", JsonPrimitive(it)) }
            deviceLabel?.let { put("p_device_label", JsonPrimitive(it)) }
            appVersion?.let { put("p_app_version", JsonPrimitive(it)) }
        }
        supabase.postgrest.rpc("register_push_token", params)
        Unit
    }

    suspend fun deactivateToken(token: String): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "deactivate_push_token",
            buildJsonObject { put("p_token", JsonPrimitive(token)) }
        )
        Unit
    }
}
