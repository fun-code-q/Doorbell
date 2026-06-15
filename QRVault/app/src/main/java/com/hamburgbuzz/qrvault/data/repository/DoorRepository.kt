package com.hamburgbuzz.qrvault.data.repository

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
 * Door-specific RPC façade. Wraps:
 *   * rotate_door_qr_token  — one-tap kill of a leaked QR sticker
 *   * set_door_location     — pin the door's GPS anchor for the geofence
 *   * set_door_dnd          — manual pause (e.g. "Do not disturb for 8h")
 */
@Singleton
class DoorRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {
    /** Returns the new qr_token and the post-rotation rotation count. */
    suspend fun rotateQrToken(doorPointId: String): Outcome<RotatedQr> = runCatchingOutcome {
        val raw = supabase.postgrest.rpc(
            "rotate_door_qr_token",
            buildJsonObject { put("p_door_point_id", JsonPrimitive(doorPointId)) }
        )
        val rows = raw.decodeList<RotatedQr>()
        rows.firstOrNull() ?: error("rotate_door_qr_token returned no row")
    }

    /** Stores the door's location and geofence radius (clamped 10..500m server-side). */
    suspend fun setLocation(
        doorPointId: String,
        latitude: Double,
        longitude: Double,
        radiusM: Int,
        accuracyM: Double?,
    ): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "set_door_location",
            buildJsonObject {
                put("p_door_point_id", JsonPrimitive(doorPointId))
                put("p_latitude",      JsonPrimitive(latitude))
                put("p_longitude",     JsonPrimitive(longitude))
                put("p_radius_m",      JsonPrimitive(radiusM))
                accuracyM?.let { put("p_accuracy_m", JsonPrimitive(it)) }
            }
        )
        Unit
    }

    /** Pass minutes=0 to clear DND immediately. Server clamps to 24h max. */
    suspend fun setDnd(doorPointId: String, minutes: Int): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "set_door_dnd",
            buildJsonObject {
                put("p_door_point_id", JsonPrimitive(doorPointId))
                put("p_minutes",       JsonPrimitive(minutes))
            }
        )
        Unit
    }

    /**
     * Set per-door quiet hours (Batch E #8). Minutes since local midnight,
     * 0..1440. Both null clears the schedule. Wrapping ranges supported
     * (e.g. start=22*60, end=7*60 = 22:00..07:00 next day).
     */
    suspend fun setQuietHours(
        doorPointId: String,
        startMin: Int?,
        endMin: Int?,
    ): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc(
            "set_door_quiet_hours",
            buildJsonObject {
                put("p_door_point_id", JsonPrimitive(doorPointId))
                if (startMin == null)
                    put("p_start_min", kotlinx.serialization.json.JsonNull)
                else
                    put("p_start_min", JsonPrimitive(startMin))
                if (endMin == null)
                    put("p_end_min", kotlinx.serialization.json.JsonNull)
                else
                    put("p_end_min", JsonPrimitive(endMin))
            }
        )
        Unit
    }

    @kotlinx.serialization.Serializable
    data class RotatedQr(
        val id: String,
        @kotlinx.serialization.SerialName("qr_token")
        val qrToken: String,
        @kotlinx.serialization.SerialName("qr_rotation_count")
        val rotationCount: Int,
    )
}
