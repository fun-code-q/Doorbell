package com.hamburgbuzz.qrvault.util

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/**
 * Heuristic OEM Autostart router (Batch K #B6).
 *
 * Xiaomi/MIUI, Oppo/ColorOS, Vivo/Funtouch, Realme, OnePlus (pre-OxygenOS
 * 13), Huawei, Honor, and Samsung all ship "battery management" screens
 * that, by default, BLOCK background FCM after the user swipes the app
 * out of recents — even though stock Android allows it. The fix is
 * per-OEM: each maintains a hidden activity in their stock launcher to
 * toggle Autostart / Background Activity / Power Manager whitelist for
 * a given package.
 *
 * `openAutostartIfApplicable(ctx)` returns true if we successfully
 * launched the OEM-specific activity. If the device is not from a
 * known-aggressive OEM (e.g. Pixel, stock Android), it returns false and
 * the caller falls back to the generic Battery Optimisations screen.
 *
 * The activity component names below are from
 * github.com/jaredrummler/AndroidShellCommand and the dontkilmyapp.com
 * project; they are stable across MIUI 12-15, ColorOS 11-14, etc.
 */
object OemAutostart {

    data class Route(
        val matches: (manufacturer: String, brand: String) -> Boolean,
        val component: ComponentName,
        val displayName: String,
    )

    private val routes = listOf(
        Route(
            matches = { m, _ -> m.contains("xiaomi", true) || m.contains("redmi", true) },
            component = ComponentName(
                "com.miui.securitycenter",
                "com.miui.permcenter.autostart.AutoStartManagementActivity",
            ),
            displayName = "MIUI Autostart",
        ),
        Route(
            matches = { m, b -> m.contains("oppo", true) || b.contains("realme", true) },
            component = ComponentName(
                "com.coloros.safecenter",
                "com.coloros.safecenter.permission.startup.StartupAppListActivity",
            ),
            displayName = "ColorOS Startup Manager",
        ),
        Route(
            matches = { m, _ -> m.contains("vivo", true) || m.contains("iqoo", true) },
            component = ComponentName(
                "com.vivo.permissionmanager",
                "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
            ),
            displayName = "Vivo iManager",
        ),
        Route(
            matches = { m, _ -> m.contains("oneplus", true) },
            component = ComponentName(
                "com.oneplus.security",
                "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity",
            ),
            displayName = "OnePlus App Auto-launch",
        ),
        Route(
            matches = { m, b -> m.contains("huawei", true) || b.contains("honor", true) },
            component = ComponentName(
                "com.huawei.systemmanager",
                "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            ),
            displayName = "Huawei Startup Manager",
        ),
        Route(
            matches = { m, _ -> m.contains("samsung", true) },
            // Samsung doesn't have an autostart screen per se; we route to
            // the per-app power management. From Android 13 there's
            // "Settings → Apps → QR Vault → Battery → Allow background activity".
            component = ComponentName(
                "com.samsung.android.lool",
                "com.samsung.android.sm.ui.battery.BatteryActivity",
            ),
            displayName = "Samsung Battery",
        ),
    )

    fun matchingRoute(ctx: Context): Route? {
        val manufacturer = Build.MANUFACTURER.orEmpty()
        val brand = Build.BRAND.orEmpty()
        return routes.firstOrNull { r ->
            r.matches(manufacturer, brand) && componentExists(ctx, r.component)
        }
    }

    fun openAutostartIfApplicable(ctx: Context): Boolean {
        val route = matchingRoute(ctx) ?: return false
        return try {
            ctx.startActivity(Intent().apply {
                component = route.component
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            true
        } catch (_: Throwable) { false }
    }

    private fun componentExists(ctx: Context, component: ComponentName): Boolean = try {
        ctx.packageManager.getActivityInfo(component, PackageManager.MATCH_DEFAULT_ONLY)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }
}
