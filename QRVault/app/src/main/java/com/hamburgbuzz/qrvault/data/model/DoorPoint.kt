package com.hamburgbuzz.qrvault.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class DoorPoint(
    val id: String,
    @SerialName("house_id")
    val houseId: String,
    val name: String,
    val description: String? = null,
    @SerialName("qr_token")
    val qrToken: String,
    @SerialName("is_active")
    val isActive: Boolean = true,
    @SerialName("sort_order")
    val sortOrder: Int = 0,
    val latitude: Double? = null,
    val longitude: Double? = null,
    @SerialName("geofence_radius_m")
    val geofenceRadiusM: Int = 50,
    @SerialName("max_rings_per_hour")
    val maxRingsPerHour: Int = 12,
    @SerialName("auto_dnd_after_unanswered")
    val autoDndAfterUnanswered: Int = 5,
    @SerialName("auto_dnd_window_minutes")
    val autoDndWindowMinutes: Int = 10,
    @SerialName("dnd_until")
    val dndUntil: String? = null,
    @SerialName("qr_rotation_count")
    val qrRotationCount: Int = 0,
    @SerialName("location_accuracy_m")
    val locationAccuracyM: Double? = null,
    @SerialName("location_set_at")
    val locationSetAt: String? = null,
    @SerialName("quiet_hours_start_min")
    val quietHoursStartMin: Int? = null,
    @SerialName("quiet_hours_end_min")
    val quietHoursEndMin: Int? = null,
    /**
     * Per-door ringtone identifier (Batch M #4):
     *   null               → bundled default (raw/doorbell_ring)
     *   "system:default"   → system default ringtone
     *   "bundled:<name>"   → raw/doorbell_<name>.ogg
     */
    @SerialName("ringtone_resource")
    val ringtoneResource: String? = null,
    @SerialName("created_at")
    val createdAt: String,
)
