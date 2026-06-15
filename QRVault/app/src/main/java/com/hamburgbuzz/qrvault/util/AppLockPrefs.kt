package com.hamburgbuzz.qrvault.util

import android.content.Context

/**
 * Per-device preference for the "Require unlock" feature. When `enabled`,
 * MainActivity puts up BiometricPrompt before exposing the dashboard.
 * Anyone with the unlocked phone in their hand still can't see the vault
 * without authenticating again — the same model as banking apps.
 *
 * Stored in plain SharedPreferences (not EncryptedSharedPreferences):
 * this is a bit toggling display, not a secret. The actual keys are in
 * EncryptedSharedPreferences via OwnerKeyRepository.
 */
object AppLockPrefs {

    private const val PREF = "qrvault.applock"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_LAST_AUTH_MS = "last_auth_ms"

    /** Re-prompt after this many ms of background time. */
    const val REPROMPT_TIMEOUT_MS = 60_000L

    fun isEnabled(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

    fun setEnabled(ctx: Context, value: Boolean) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_ENABLED, value).apply()
        if (value) markAuthed(ctx) // grant the session that just toggled it
    }

    fun markAuthed(ctx: Context) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putLong(KEY_LAST_AUTH_MS, System.currentTimeMillis()).apply()
    }

    fun needsPrompt(ctx: Context): Boolean {
        if (!isEnabled(ctx)) return false
        val last = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getLong(KEY_LAST_AUTH_MS, 0L)
        return System.currentTimeMillis() - last > REPROMPT_TIMEOUT_MS
    }
}
