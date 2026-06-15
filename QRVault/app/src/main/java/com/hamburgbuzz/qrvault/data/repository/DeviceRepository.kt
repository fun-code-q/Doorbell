package com.hamburgbuzz.qrvault.data.repository

import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DeviceRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {
    @Serializable
    data class Device(
        val id: String,
        val platform: String,
        @SerialName("app_version") val appVersion: String? = null,
        @SerialName("device_label") val deviceLabel: String? = null,
        @SerialName("is_active") val isActive: Boolean,
        @SerialName("last_seen_at") val lastSeenAt: String,
        @SerialName("created_at") val createdAt: String,
    )

    suspend fun list(): Outcome<List<Device>> = runCatchingOutcome {
        supabase.postgrest.rpc("list_my_devices").decodeList<Device>()
    }

    suspend fun revoke(deviceId: String): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "revoke_my_device",
            buildJsonObject { put("p_subscription_id", JsonPrimitive(deviceId)) }
        )
        Unit
    }
}
