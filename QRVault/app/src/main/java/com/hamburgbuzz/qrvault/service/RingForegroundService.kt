package com.hamburgbuzz.qrvault.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import com.hamburgbuzz.qrvault.notification.RingNotifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * FOREGROUND_SERVICE_TYPE_SPECIAL_USE service that holds the system in
 * "active ring" state. The same CallStyle notification we want the user
 * to see IS the foreground notification — we do NOT post a second
 * placeholder, that was a bug pre-fix.
 *
 * Why specialUse not phoneCall:
 *   `phoneCall` on Android 14+ is only safe when the app integrates with
 *   android.telecom.ConnectionService and routes calls via the system
 *   Telecom service. We do neither (the doorbell is messaging, not VoIP)
 *   so the safer + Play-Store-acceptable type is specialUse with a
 *   `<property name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE">`
 *   declared in the manifest <service>.
 *
 * Lifecycle:
 *   * start()         called from QrFcmService.onMessageReceived
 *   * onStartCommand  posts CallStyle as the foreground notification +
 *                     holds a PARTIAL_WAKE_LOCK + arms a 60s auto-stop
 *   * stop()          called from RingActionReceiver (Answer/Decline) or
 *                     from IncomingRingActivity once the user acts
 */
class RingForegroundService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var autoStopJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val ringId       = intent?.getStringExtra(EXTRA_RING_ID).orEmpty()
        val houseId      = intent?.getStringExtra(EXTRA_HOUSE_ID).orEmpty()
        val doorPointId  = intent?.getStringExtra(EXTRA_DOOR_POINT_ID)
        val doorLocation = intent?.getStringExtra(EXTRA_DOOR_LOCATION).orEmpty()
        val callerLabel  = intent?.getStringExtra(EXTRA_CALLER_LABEL).orEmpty()
        val ringtone     = intent?.getStringExtra(EXTRA_RINGTONE_RESOURCE)
        if (ringId.isEmpty()) {
            stopSelf(startId)
            return START_NOT_STICKY
        }

        // Build the user-visible CallStyle notification. This is what fires
        // the full-screen intent into IncomingRingActivity and what shows
        // Answer/Decline on the lockscreen + Wear watch.
        val callNotif = RingNotifier.buildIncoming(
            ctx = this,
            ringId = ringId,
            houseId = houseId,
            doorPointId = doorPointId,
            doorLocation = doorLocation,
            callerLabel = callerLabel.ifBlank {
                getString(com.hamburgbuzz.qrvault.R.string.visitor_at_door)
            },
            ringtoneResource = ringtone,
        )

        // The CallStyle notification IS the foreground notification — no
        // second placeholder. Use the ring id's hash as the notification
        // id so multiple concurrent rings (rare) each get their own.
        val notificationId = ringId.hashCode()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                notificationId,
                callNotif,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(notificationId, callNotif)
        }

        // Acquire a partial wake-lock so the CPU stays awake long enough
        // for the ringtone to actually start playing. Released on stop.
        acquireWakeLockIfNeeded()

        // Auto-stop after 60 seconds if no Answer/Decline arrives. The
        // activity's own 45s auto-decline handles the user-visible cancel;
        // this is a defence-in-depth so a leaked service doesn't keep the
        // notification forever.
        autoStopJob?.cancel()
        autoStopJob = scope.launch {
            delay(60_000L)
            stopSelf()
        }

        return START_NOT_STICKY
    }

    private fun acquireWakeLockIfNeeded() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "qrvault:ring",
        ).apply {
            setReferenceCounted(false)
            acquire(90_000L) // hard ceiling: 90s. Released in onDestroy too.
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        autoStopJob?.cancel()
        wakeLock?.runCatching { if (isHeld) release() }
        wakeLock = null
        scope.coroutineContext[Job]?.cancel()
    }

    companion object {
        const val EXTRA_RING_ID           = "ring_id"
        const val EXTRA_HOUSE_ID          = "house_id"
        const val EXTRA_DOOR_POINT_ID     = "door_point_id"
        const val EXTRA_DOOR_LOCATION     = "door_location"
        const val EXTRA_CALLER_LABEL      = "caller_label"
        const val EXTRA_RINGTONE_RESOURCE = "ringtone_resource"

        fun start(
            ctx: Context,
            ringId: String,
            houseId: String,
            doorPointId: String?,
            doorLocation: String,
            callerLabel: String,
            ringtoneResource: String? = null,
        ) {
            val i = Intent(ctx, RingForegroundService::class.java).apply {
                putExtra(EXTRA_RING_ID, ringId)
                putExtra(EXTRA_HOUSE_ID, houseId)
                putExtra(EXTRA_DOOR_POINT_ID, doorPointId)
                putExtra(EXTRA_DOOR_LOCATION, doorLocation)
                putExtra(EXTRA_CALLER_LABEL, callerLabel)
                putExtra(EXTRA_RINGTONE_RESOURCE, ringtoneResource)
            }
            // startForegroundService gives the service 5 seconds to call
            // startForeground() before Android crashes us with
            // ForegroundServiceDidNotStartInTimeException. We call it as
            // the first thing in onStartCommand, well within the budget.
            ctx.startForegroundService(i)
        }

        fun stop(ctx: Context, ringId: String) {
            ctx.stopService(Intent(ctx, RingForegroundService::class.java))
        }
    }
}
