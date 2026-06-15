package com.hamburgbuzz.qrvault.util

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await

/**
 * Snapshot of every system-level condition that affects ring delivery,
 * each tagged with a severity:
 *   OK       — fine
 *   WARNING  — works today, will degrade tomorrow (e.g. Doze whitelist not granted)
 *   BLOCKING — rings WILL NOT reach the user until fixed
 *
 * Consumed by the PowerUserWizard / a "Reliability Health" screen.
 */
enum class HealthStatus { OK, WARNING, BLOCKING }

data class HealthCheck(
    val id: String,
    val title: String,
    val description: String,
    val status: HealthStatus,
    /** Optional Settings intent action that takes the user to fix this. */
    val fixIntentAction: String? = null,
)

object RingHealthCheck {

    /** Custom intent action used by HealthScreen to invoke the OEM router. */
    const val ACTION_OEM_AUTOSTART = "qrvault.OEM_AUTOSTART"

    suspend fun runAll(ctx: Context): List<HealthCheck> = buildList {
        add(checkNotificationsPermission(ctx))
        add(checkNotificationsChannelEnabled(ctx))
        add(checkBatteryOptimisation(ctx))
        add(checkPlayServices(ctx))
        add(checkFcmToken())
        add(checkExactAlarm(ctx))
        add(checkFullScreenIntentAllowed(ctx))
        // OEM autostart routing. Only shown on devices from
        // known-aggressive OEMs (Xiaomi/Oppo/Vivo/etc.); absent on Pixel.
        checkOemAutostart(ctx)?.let { add(it) }
    }

    private fun checkOemAutostart(ctx: Context): HealthCheck? {
        val route = OemAutostart.matchingRoute(ctx) ?: return null
        return HealthCheck(
            id = "oem_autostart",
            title = "Vendor auto-start",
            description = "Your phone's vendor may block doorbell pushes after you swipe the app from recents. Tap Fix to allow auto-start.",
            status = HealthStatus.WARNING,
            // We can't query OEM autostart state — they don't expose an
            // API. Show this as a soft warning on aggressive-OEM devices.
            fixIntentAction = ACTION_OEM_AUTOSTART,
        )
    }

    private fun checkNotificationsPermission(ctx: Context): HealthCheck {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return HealthCheck("notifications", "Notifications", "Always-on (pre-Android 13).", HealthStatus.OK)
        }
        val granted = ContextCompat.checkSelfPermission(
            ctx, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        return HealthCheck(
            id = "notifications",
            title = "Notifications permission",
            description = if (granted) "Granted." else "Without this, rings will never reach you.",
            status = if (granted) HealthStatus.OK else HealthStatus.BLOCKING,
            fixIntentAction = Settings.ACTION_APP_NOTIFICATION_SETTINGS,
        )
    }

    private fun checkNotificationsChannelEnabled(ctx: Context): HealthCheck {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val channel = nm.getNotificationChannel("doorbell_rings")
        val blocked = channel != null && channel.importance == NotificationManager.IMPORTANCE_NONE
        return HealthCheck(
            id = "channel",
            title = "Doorbell channel",
            description = when {
                channel == null -> "Channel not yet created (will appear after first ring)."
                blocked -> "You've muted the Doorbell Rings channel. Re-enable it in Notification Settings."
                else -> "High importance."
            },
            status = when {
                channel == null -> HealthStatus.WARNING
                blocked -> HealthStatus.BLOCKING
                else -> HealthStatus.OK
            },
            fixIntentAction = Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS,
        )
    }

    private fun checkBatteryOptimisation(ctx: Context): HealthCheck {
        val pm = ctx.getSystemService(PowerManager::class.java)
        val ignoring = pm?.isIgnoringBatteryOptimizations(ctx.packageName) == true
        return HealthCheck(
            id = "battery",
            title = "Battery optimisation",
            description = if (ignoring)
                "Doorbell is exempt from Doze."
            else
                "Android may delay or drop rings while your phone is sleeping.",
            status = if (ignoring) HealthStatus.OK else HealthStatus.WARNING,
            fixIntentAction = Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        )
    }

    private fun checkPlayServices(ctx: Context): HealthCheck {
        val code = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(ctx)
        return HealthCheck(
            id = "play_services",
            title = "Google Play services",
            description = when (code) {
                ConnectionResult.SUCCESS -> "Available."
                ConnectionResult.SERVICE_MISSING -> "Not installed. Required for FCM."
                ConnectionResult.SERVICE_DISABLED -> "Disabled."
                ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED -> "Update required."
                else -> "Unavailable (code $code)."
            },
            status = if (code == ConnectionResult.SUCCESS) HealthStatus.OK else HealthStatus.BLOCKING,
        )
    }

    private suspend fun checkFcmToken(): HealthCheck = try {
        val token = FirebaseMessaging.getInstance().token.await()
        if (token.isNullOrBlank()) HealthCheck(
            id = "fcm_token",
            title = "FCM registration",
            description = "Couldn't get a Firebase token. Push will not arrive.",
            status = HealthStatus.BLOCKING,
        ) else HealthCheck(
            id = "fcm_token",
            title = "FCM registration",
            description = "Token registered (…${token.takeLast(8)}).",
            status = HealthStatus.OK,
        )
    } catch (t: Throwable) {
        HealthCheck(
            id = "fcm_token",
            title = "FCM registration",
            description = "Failed: ${t.message ?: "unknown"}",
            status = HealthStatus.BLOCKING,
        )
    }

    private fun checkExactAlarm(ctx: Context): HealthCheck {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return HealthCheck("exact_alarm", "Exact alarms", "N/A on this Android version.", HealthStatus.OK)
        }
        // We do not currently schedule exact alarms; only flag if the user
        // ever disables them globally. Soft warning.
        return HealthCheck(
            id = "exact_alarm",
            title = "Exact alarms",
            description = "Not used by QRVault directly.",
            status = HealthStatus.OK,
        )
    }

    private fun checkFullScreenIntentAllowed(ctx: Context): HealthCheck {
        val granted = FullScreenIntentGuard.isGranted(ctx)
        return HealthCheck(
            id = "fullscreen",
            title = "Full-screen ring on lock screen",
            description = if (granted)
                "Rings interrupt the lock screen with the call-style UI."
            else
                "Disabled. Rings will show as a heads-up instead of full-screen on the lock screen.",
            // Treat as BLOCKING — without this, the headline doorbell UX
            // (full-screen lock-screen ring) silently doesn't work.
            status = if (granted) HealthStatus.OK else HealthStatus.BLOCKING,
            fixIntentAction = if (granted) null else Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
        )
    }
}
