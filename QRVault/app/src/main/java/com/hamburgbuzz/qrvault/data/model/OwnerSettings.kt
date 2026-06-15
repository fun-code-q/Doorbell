package com.hamburgbuzz.qrvault.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The schema no longer has an `fcm_token` column on `owner_settings`.
 * FCM tokens live in `push_subscriptions` and are managed by
 * PushRepository / PushTokenSyncWorker.
 */
@Serializable
data class OwnerSettings(
    val id: String? = null,
    @SerialName("user_id")
    val userId: String,
    @SerialName("sound_enabled")
    val soundEnabled: Boolean = true,
    @SerialName("vibration_enabled")
    val vibrationEnabled: Boolean = true,
    @SerialName("push_enabled")
    val pushEnabled: Boolean = true,
    val language: String = "en",
    @SerialName("auto_logout_minutes")
    val autoLogoutMinutes: Int = 15,
    @SerialName("active_house_id")
    val activeHouseId: String? = null,
    /** IANA timezone (e.g. "Europe/Berlin"). Used for door quiet-hours. */
    val timezone: String = "UTC",
    /** Up to 5 owner-customised quick replies; null = use bundled defaults. */
    @SerialName("quick_replies")
    val quickReplies: List<String>? = null,
)
