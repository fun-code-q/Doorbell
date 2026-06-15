package com.hamburgbuzz.qrvault.notification

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import com.hamburgbuzz.qrvault.MainActivity
import com.hamburgbuzz.qrvault.R
import com.hamburgbuzz.qrvault.ui.activity.IncomingRingActivity

/**
 * Builds the CallStyle (Android 12+) notification that surfaces an
 * incoming doorbell ring. On Android 11 and below the fallback is a
 * MessagingStyle with action buttons.
 *
 * The Answer / Decline taps come back through RingActionReceiver, which
 * dispatches to the repository so the state lands in Supabase and the
 * receipt is closed even when the app process is dead.
 */
object RingNotifier {

    fun buildIncoming(
        ctx: Context,
        ringId: String,
        houseId: String,
        doorPointId: String?,
        doorLocation: String,
        callerLabel: String,
        ringtoneResource: String? = null,
    ): Notification {
        val caller = Person.Builder()
            .setName(callerLabel)
            .setImportant(true)
            .build()

        val fullScreenIntent = Intent(ctx, IncomingRingActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(IncomingRingActivity.EXTRA_RING_ID, ringId)
            putExtra(IncomingRingActivity.EXTRA_HOUSE_ID, houseId)
            putExtra(IncomingRingActivity.EXTRA_DOOR_POINT_ID, doorPointId)
            putExtra(IncomingRingActivity.EXTRA_DOOR_LOCATION, doorLocation)
            putExtra(IncomingRingActivity.EXTRA_RINGTONE_RESOURCE, ringtoneResource)
        }
        val fullScreenPi = PendingIntent.getActivity(
            ctx,
            ringId.hashCode(),
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val answerPi = pendingActionIntent(ctx, RingActionReceiver.ACTION_ANSWER, ringId, houseId)
        val declinePi = pendingActionIntent(ctx, RingActionReceiver.ACTION_DECLINE, ringId, houseId)

        // Wear OS bridging (Batch H #17): build a WearableExtender with the
        // same Answer/Decline actions so a paired watch shows the ring with
        // first-class actions rather than the bridged-notification fallback.
        val answerAction = androidx.core.app.NotificationCompat.Action.Builder(
            R.drawable.ic_launcher_foreground,
            ctx.getString(R.string.accept_ring),
            answerPi,
        ).build()
        val declineAction = androidx.core.app.NotificationCompat.Action.Builder(
            R.drawable.ic_launcher_foreground,
            ctx.getString(R.string.decline_ring),
            declinePi,
        ).build()
        val wearExtender = androidx.core.app.NotificationCompat.WearableExtender()
            .addAction(answerAction)
            .addAction(declineAction)
            .setHintContentIntentLaunchesActivity(true)
            .setBridgeTag("doorbell_ring")

        val builder = NotificationCompat.Builder(ctx, RingChannels.RING_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(ctx.getString(R.string.notif_title))
            .setContentText(doorLocation)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setLocalOnly(false)
            .setOngoing(true)
            .setColorized(true)
            .setAutoCancel(false)
            .setFullScreenIntent(fullScreenPi, true)
            .addPerson(caller)
            .setStyle(
                NotificationCompat.CallStyle.forIncomingCall(caller, declinePi, answerPi)
            )
            .extend(wearExtender)
        return builder.build()
    }

    private fun pendingActionIntent(
        ctx: Context,
        action: String,
        ringId: String,
        houseId: String,
    ): PendingIntent {
        val i = Intent(ctx, RingActionReceiver::class.java).apply {
            this.action = action
            putExtra(RingActionReceiver.EXTRA_RING_ID, ringId)
            putExtra(RingActionReceiver.EXTRA_HOUSE_ID, houseId)
        }
        return PendingIntent.getBroadcast(
            ctx,
            (action + ringId).hashCode(),
            i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    fun cancel(ctx: Context, ringId: String) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.cancel(ringId.hashCode())
    }

    fun launchIntoApp(ctx: Context): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(
            ctx, 0, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
