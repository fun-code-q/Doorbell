package com.hamburgbuzz.qrvault.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat

/**
 * NotificationChannel IDs and a single idempotent setup method.
 *
 * The default channel id MUST match the FCM `default_notification_channel_id`
 * meta-data in AndroidManifest, otherwise Android falls back to "Misc" and
 * mutes the heads-up on Android 13+.
 *
 * IMPORTANT: the channel does NOT set a sound. The sole audio source is
 * the IncomingRingActivity's looping ringtone player. If we set a channel
 * sound, Android plays it once when the notification posts AND the
 * activity then plays its own loop — two simultaneous audio streams,
 * stuttering for the first few seconds. (Fixed bug.)
 *
 * The notification channel still vibrates, because vibration is owned at
 * the channel level and only fires once per notification, which is
 * correct.
 */
object RingChannels {
    const val RING_ID = "doorbell_rings"
    const val ACTIVE_SERVICE_ID = "doorbell_active_call"

    fun ensure(nm: NotificationManager, ctx: Context) {
        val ringChannel = NotificationChannel(
            RING_ID,
            ctx.getString(com.hamburgbuzz.qrvault.R.string.notif_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = ctx.getString(com.hamburgbuzz.qrvault.R.string.notif_channel_desc)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 1000, 500, 1000, 500, 1000)
            lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            setShowBadge(true)
            // Sound is intentionally NOT set here — the activity owns it.
            setSound(null, null)
            setBypassDnd(false)
        }
        val activeChannel = NotificationChannel(
            ACTIVE_SERVICE_ID,
            ctx.getString(com.hamburgbuzz.qrvault.R.string.notif_channel_active_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = ctx.getString(com.hamburgbuzz.qrvault.R.string.notif_channel_active_desc)
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
        }
        nm.createNotificationChannels(listOf(ringChannel, activeChannel))
    }
}
