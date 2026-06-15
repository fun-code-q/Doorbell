package com.hamburgbuzz.qrvault.util

import android.app.Activity
import android.content.Context
import android.util.Log
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import com.google.android.play.core.ktx.requestAppUpdateInfo

/**
 * Play Core in-app updates (Batch O #6).
 *
 * On every MainActivity foreground we ask Play if a newer build is
 * available. Two flavours:
 *   * FLEXIBLE  — background download + an in-app prompt to restart.
 *   * IMMEDIATE — full-screen block until the user updates. We use this
 *                 only when the available update is flagged as a
 *                 high-priority security fix by Play Console.
 *
 * The Play Core libs handle the actual download/install; we just kick
 * off the right flow.
 */
object InAppUpdates {

    private const val TAG = "InAppUpdates"
    private const val IMMEDIATE_PRIORITY_THRESHOLD = 4   // Play priorities 0..5

    suspend fun checkAndPrompt(activity: Activity) {
        val manager: AppUpdateManager = AppUpdateManagerFactory.create(activity)
        try {
            val info = manager.requestAppUpdateInfo()
            if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE) return

            val priority = info.updatePriority()
            val type = if (priority >= IMMEDIATE_PRIORITY_THRESHOLD) AppUpdateType.IMMEDIATE
                       else AppUpdateType.FLEXIBLE

            if (!info.isUpdateTypeAllowed(type)) {
                Log.d(TAG, "Update available but ${if (type == AppUpdateType.IMMEDIATE) "IMMEDIATE" else "FLEXIBLE"} not allowed")
                return
            }

            manager.startUpdateFlowForResult(
                info,
                activity,
                AppUpdateOptions.newBuilder(type).build(),
                /* requestCode = */ REQUEST_CODE,
            )
        } catch (t: Throwable) {
            Log.w(TAG, "in-app update check failed", t)
        }
    }

    /**
     * Completes a previously-started FLEXIBLE update (download finished
     * → installs on next foreground). Safe to call repeatedly.
     */
    fun completeIfPending(ctx: Context) {
        val manager = AppUpdateManagerFactory.create(ctx)
        manager.appUpdateInfo.addOnSuccessListener { info ->
            if (info.installStatus() ==
                com.google.android.play.core.install.model.InstallStatus.DOWNLOADED) {
                manager.completeUpdate()
            }
        }
    }

    const val REQUEST_CODE = 0xAFAF
}
