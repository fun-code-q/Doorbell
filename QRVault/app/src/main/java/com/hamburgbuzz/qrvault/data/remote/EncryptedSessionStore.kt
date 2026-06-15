package com.hamburgbuzz.qrvault.data.remote

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import io.github.jan.supabase.auth.SessionManager
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Persists the Supabase auth session to disk via EncryptedSharedPreferences
 * (AES-GCM-wrapped by a master key in the Android Keystore). This replaces
 * the previous SharedPreferencesSessionManager which stored a refresh token
 * in plaintext recoverable via `adb backup` on rooted devices.
 *
 * Returns `null` from loadSession() when there is no saved session, so the
 * Supabase client treats the user as logged-out. The previous implementation
 * decoded "{}" as a corrupt UserSession, thrashing the auth state on cold
 * start.
 */
class EncryptedSessionStore(context: Context) : SessionManager {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private val prefs = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    override suspend fun saveSession(session: UserSession) {
        prefs.edit().putString(KEY_SESSION, json.encodeToString(session)).apply()
    }

    override suspend fun loadSession(): UserSession? {
        val blob = prefs.getString(KEY_SESSION, null) ?: return null
        return try {
            json.decodeFromString(UserSession.serializer(), blob)
        } catch (t: Throwable) {
            prefs.edit().remove(KEY_SESSION).apply()
            null
        }
    }

    override suspend fun deleteSession() {
        prefs.edit().remove(KEY_SESSION).apply()
    }

    private companion object {
        const val FILE = "qrvault.session"
        const val KEY_SESSION = "supabase_session"
    }
}
