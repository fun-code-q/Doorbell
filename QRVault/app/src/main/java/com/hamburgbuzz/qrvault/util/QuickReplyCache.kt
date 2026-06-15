package com.hamburgbuzz.qrvault.util

import android.content.Context

/**
 * Tiny SharedPreferences-backed cache of the owner's custom quick replies.
 *
 * The Settings VM writes to this cache after every owner_settings load,
 * so by the time IncomingRingActivity wakes up on FCM (potentially with
 * the device offline) the cached strings are available synchronously.
 *
 * Not encrypted — these are user-visible text templates the owner typed
 * for themselves. Privacy-sensitive material doesn't live here.
 */
object QuickReplyCache {
    private const val PREF = "qrvault.quick_replies"
    private const val KEY  = "replies_v1"
    private const val SEP  = ""  // unit separator: cannot appear in user text

    fun save(ctx: Context, replies: List<String>?) {
        val sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        if (replies.isNullOrEmpty()) sp.edit().remove(KEY).apply()
        else sp.edit().putString(KEY, replies.take(5).joinToString(SEP)).apply()
    }

    fun load(ctx: Context): List<String>? {
        val raw = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(KEY, null)
            ?: return null
        return raw.split(SEP).filter { it.isNotBlank() }.take(5)
    }
}
