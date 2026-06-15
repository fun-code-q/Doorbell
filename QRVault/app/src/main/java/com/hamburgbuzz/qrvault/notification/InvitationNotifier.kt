package com.hamburgbuzz.qrvault.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.hamburgbuzz.qrvault.MainActivity
import com.hamburgbuzz.qrvault.R

/**
 * Posts a low-urgency notification when a house invitation lands. We
 * intentionally don't full-screen this — it's not a doorbell ring.
 *
 * Tapping the notification opens MainActivity with extras the app uses
 * to deep-link into the pending-invitations screen on next foreground.
 */
object InvitationNotifier {

    private const val CHANNEL_ID = "invitations"
    private const val CHANNEL_NAME = "Invitations"
    private const val CHANNEL_DESC = "House membership invites from owners and managers."

    fun post(ctx: Context, invitationId: String, houseName: String) {
        ensureChannel(ctx)
        val tapIntent = Intent(ctx, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(EXTRA_DEEP_LINK, "invitation")
            putExtra(EXTRA_INVITATION_ID, invitationId)
        }
        val pi = PendingIntent.getActivity(
            ctx, invitationId.hashCode(),
            tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(ctx.getString(R.string.invitation_notif_title))
            .setContentText(
                if (houseName.isNotBlank())
                    ctx.getString(R.string.invitation_notif_text_named, houseName)
                else ctx.getString(R.string.invitation_notif_text_generic)
            )
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        (ctx.getSystemService(NotificationManager::class.java))
            .notify(NOTIFICATION_ID_BASE + invitationId.hashCode(), n)
    }

    private fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = CHANNEL_DESC
                enableVibration(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
            }
        )
    }

    const val EXTRA_DEEP_LINK = "deep_link"
    const val EXTRA_INVITATION_ID = "invitation_id"
    private const val NOTIFICATION_ID_BASE = 0xCE00
}
