package com.hamburgbuzz.qrvault.util

import android.content.Context
import com.google.firebase.crashlytics.FirebaseCrashlytics

/**
 * Opt-in Crashlytics wrapper (Batch O #7).
 *
 * Crashlytics is OFF by default. The user toggles it via Settings →
 * Diagnostics → Send crash reports, which writes
 * `qrvault.diagnostics:crash_opt_in=true` into a plain SharedPreferences.
 *
 * Why opt-in: this is an EU-targeted product. Even though Crashlytics
 * ships anonymous stack traces only, GDPR requires user agency over
 * any third-party data flow. Default-off keeps us safe on day one;
 * users who want better support can flip the toggle.
 *
 * Whenever the toggle changes we forward the state to Firebase via
 * `setCrashlyticsCollectionEnabled`, which Firebase handles natively
 * (no app restart needed).
 */
object CrashReporting {

    private const val PREF = "qrvault.diagnostics"
    private const val KEY  = "crash_opt_in"

    fun init(ctx: Context) {
        val enabled = isEnabled(ctx)
        FirebaseCrashlytics.getInstance().isCrashlyticsCollectionEnabled = enabled
    }

    fun setOptIn(ctx: Context, enabled: Boolean) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY, enabled)
            .apply()
        FirebaseCrashlytics.getInstance().isCrashlyticsCollectionEnabled = enabled
    }

    fun isEnabled(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getBoolean(KEY, false)

    /**
     * Log a non-fatal exception when opted-in. No-op when disabled, so
     * call-sites don't need to gate.
     */
    fun recordException(ctx: Context, t: Throwable) {
        if (!isEnabled(ctx)) return
        FirebaseCrashlytics.getInstance().recordException(t)
    }
}
