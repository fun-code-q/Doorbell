package com.hamburgbuzz.qrvault.service

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.hamburgbuzz.qrvault.data.repository.PushRepository
import com.hamburgbuzz.qrvault.worker.PushTokenSyncWorker
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The FCM entry point on Android.
 *
 * Why is this NOT a notification-payload handler?
 *   The Edge Function sends data-only payloads so this service can do
 *   real work — fetching the ring row, decrypting (if needed),
 *   starting a foreground service, posting the CallStyle notification.
 *   If we used FCM "notification" payloads, FCM itself would post a
 *   generic notif when the app is killed and we'd lose the call-style UX.
 *
 * On token rotation we enqueue a WorkManager job to upsert the new token
 * into Supabase. The job is durable across reboots and unreliable
 * networks, so first-launch / FCM-cycle scenarios stay reliable.
 */
@AndroidEntryPoint
class QrFcmService : FirebaseMessagingService() {

    @Inject lateinit var pushRepo: PushRepository

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "onNewToken")
        PushTokenSyncWorker.enqueue(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        when (data["type"]) {
            "ring_call" -> handleRingCall(data)
            "invitation" -> handleInvitation(data)
            else -> Log.d(TAG, "ignoring data payload type=${data["type"]}")
        }
    }

    private fun handleRingCall(data: Map<String, String>) {
        val ringId       = data["ring_id"] ?: return
        val houseId      = data["house_id"] ?: return
        val doorPointId  = data["door_point_id"]?.takeIf { it.isNotBlank() }
        val doorLocation = data["door_location"] ?: getString(com.hamburgbuzz.qrvault.R.string.visitor_at_door)
        val ringtone     = data["ringtone_resource"]?.takeIf { it.isNotBlank() }
        RingForegroundService.start(
            ctx = applicationContext,
            ringId = ringId,
            houseId = houseId,
            doorPointId = doorPointId,
            doorLocation = doorLocation,
            callerLabel = doorLocation,
            ringtoneResource = ringtone,
        )
    }

    private fun handleInvitation(data: Map<String, String>) {
        val invId = data["invitation_id"] ?: return
        val houseName = data["house_name"] ?: ""
        com.hamburgbuzz.qrvault.notification.InvitationNotifier.post(applicationContext, invId, houseName)
    }

    private companion object { const val TAG = "QrFcmService" }
}
