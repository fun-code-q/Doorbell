package com.hamburgbuzz.qrvault.util

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings

/**
 * Android 14+ (API 34) requires non-system "calling" apps to be granted
 * `android.permission.USE_FULL_SCREEN_INTENT` explicitly by the user via
 * Settings → Special access → "Manage full screen intents". Otherwise
 * the system silently downgrades our setFullScreenIntent() call to a
 * heads-up notification, and the lock-screen ring UI never appears.
 *
 * NotificationManager.canUseFullScreenIntent() returns the current state.
 * We expose:
 *   * isGranted(ctx) — true when the call-style UI will fire as expected
 *   * settingsIntent(ctx) — the Settings deep-link that routes the user
 *     straight to the toggle for our app
 *
 * The Reliability Health screen surfaces this. MainActivity also runs a
 * one-time soft check on first foreground after install.
 */
object FullScreenIntentGuard {

    fun isGranted(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
        val nm = ctx.getSystemService(NotificationManager::class.java)
        return nm.canUseFullScreenIntent()
    }

    fun settingsIntent(ctx: Context): Intent? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return null
        return Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
            data = android.net.Uri.parse("package:${ctx.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }
}
