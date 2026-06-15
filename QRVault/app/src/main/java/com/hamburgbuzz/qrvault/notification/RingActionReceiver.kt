package com.hamburgbuzz.qrvault.notification

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.hamburgbuzz.qrvault.data.repository.RingRepository
import com.hamburgbuzz.qrvault.service.RingForegroundService
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Handles Answer / Decline broadcasts from the CallStyle notification.
 * The action lands in the repository (which updates Supabase) and the
 * foreground service is dismissed.
 *
 * goAsync() keeps the receiver alive long enough for the coroutine to
 * finish on a background dispatcher; ANR is impossible because the work
 * is on Dispatchers.IO.
 */
@AndroidEntryPoint
class RingActionReceiver : BroadcastReceiver() {

    @Inject lateinit var rings: RingRepository

    override fun onReceive(context: Context, intent: Intent) {
        val ringId  = intent.getStringExtra(EXTRA_RING_ID) ?: return
        val houseId = intent.getStringExtra(EXTRA_HOUSE_ID) ?: return
        val pending = goAsync()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                when (intent.action) {
                    ACTION_ANSWER -> rings.acknowledge(ringId)
                    ACTION_DECLINE -> rings.dismiss(ringId)
                }
            } finally {
                RingForegroundService.stop(context, ringId)
                RingNotifier.cancel(context, ringId)
                // Dismiss any heads-up that the system may still be holding.
                context.getSystemService(NotificationManager::class.java)
                    .cancel(ringId.hashCode())
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_ANSWER  = "com.hamburgbuzz.qrvault.RING_ANSWER"
        const val ACTION_DECLINE = "com.hamburgbuzz.qrvault.RING_DECLINE"
        const val EXTRA_RING_ID  = "ring_id"
        const val EXTRA_HOUSE_ID = "house_id"
    }
}
