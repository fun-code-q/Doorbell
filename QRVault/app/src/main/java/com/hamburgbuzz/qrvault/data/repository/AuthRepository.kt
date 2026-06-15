package com.hamburgbuzz.qrvault.data.repository

import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val supabase: SupabaseClient,
) {
    val isAuthenticated: Flow<Boolean> =
        supabase.auth.sessionStatus.map { it is SessionStatus.Authenticated }

    val isInitialised: Flow<Boolean> =
        supabase.auth.sessionStatus.map { it !is SessionStatus.Initializing }

    fun currentUserId(): String? = supabase.auth.currentUserOrNull()?.id

    fun currentUserEmail(): String? = supabase.auth.currentUserOrNull()?.email

    /**
     * True once Supabase confirms the user clicked the email-verification
     * link. We gate features that send pushes (publishing keys, accepting
     * invitations) on this so a typo-email can't lock out the real owner.
     */
    fun isEmailConfirmed(): Boolean =
        supabase.auth.currentUserOrNull()?.emailConfirmedAt != null

    val emailConfirmed: Flow<Boolean> =
        supabase.auth.sessionStatus.map { isEmailConfirmed() }

    suspend fun signIn(email: String, password: String): Outcome<Unit> = runCatchingOutcome {
        supabase.auth.signInWith(Email) {
            this.email = email.trim()
            this.password = password
        }
        Unit
    }

    suspend fun signUp(email: String, password: String): Outcome<Unit> = runCatchingOutcome {
        supabase.auth.signUpWith(Email) {
            this.email = email.trim()
            this.password = password
        }
        Unit
    }

    suspend fun signOut(): Outcome<Unit> = runCatchingOutcome {
        supabase.auth.signOut()
        Unit
    }

    // -----------------------------------------------------------------
    // Password recovery (forgot password flow).
    //
    // Supabase mails the user a recovery URL. We tell it to redirect to
    // our deep link (`qrvault://auth/reset`) so the link reopens the app;
    // MainActivity hands the URL to `consumeRecoveryUrl` which puts the
    // session into recovery mode, then ResetPasswordScreen calls
    // `updatePassword`.
    // -----------------------------------------------------------------
    suspend fun resetPasswordForEmail(
        email: String,
        redirectUrl: String? = null,
    ): Outcome<Unit> = runCatchingOutcome {
        supabase.auth.resetPasswordForEmail(
            email = email.trim(),
            redirectUrl = redirectUrl,
        )
        Unit
    }

    suspend fun consumeRecoveryUrl(url: String): Outcome<Unit> = runCatchingOutcome {
        // Supabase Kotlin's deep-link parsing API surface differs across
        // 3.x versions (parseSessionFromUrl was added in 3.6+). For now
        // we just confirm the URL looks like a recovery URL and let the
        // UI navigate to ResetPasswordScreen — the actual session import
        // happens via the Android Intent flow Supabase's gotrue plugin
        // wires automatically when the URL matches its redirect host.
        // TODO: once we re-pin to a Supabase version with stable URL
        // parsing, plumb the access_token fragment into auth.importSession.
        require(url.contains("type=recovery") || url.contains("access_token=")) {
            "Not a recovery URL"
        }
        Unit
    }

    suspend fun updatePassword(newPassword: String): Outcome<Unit> = runCatchingOutcome {
        supabase.auth.updateUser { password = newPassword }
        Unit
    }

    suspend fun resendEmailConfirmation(email: String): Outcome<Unit> = runCatchingOutcome {
        // signUpWith again is a no-op on Supabase's side except it
        // re-sends the confirmation email if the user is unverified.
        supabase.auth.resendEmail(
            type = io.github.jan.supabase.auth.OtpType.Email.SIGNUP,
            email = email.trim(),
        )
        Unit
    }

    /**
     * Change the signed-in user's email. Supabase sends a confirmation
     * link to the NEW address; the change is not effective until the user
     * clicks it. Until then `currentUserEmail()` still returns the old
     * address.
     */
    suspend fun updateEmail(newEmail: String): Outcome<Unit> = runCatchingOutcome {
        supabase.auth.updateUser { email = newEmail.trim() }
        Unit
    }

    suspend fun ensureOwnerHouse(): Outcome<String> = runCatchingOutcome {
        // RPC returns a UUID; PostgREST surfaces it as a primitive.
        val raw = supabase.postgrest.rpc("ensure_owner_house").data
        raw.trim('"')
    }

    /**
     * GDPR Article 17 (Batch E #7). Server-side this triggers a cascade
     * delete of every row belonging to this user across `public.*` and
     * finally drops the auth.users row. After this returns successfully
     * the caller must sign out locally and wipe any device-local state.
     */
    suspend fun deleteMyAccount(): Outcome<Unit> = runCatchingOutcome {
        supabase.postgrest.rpc("delete_my_account")
        Unit
    }

    /**
     * Export the user's owner_settings as JSON (Batch N #10). The blob
     * carries portable fields only — id / user_id / timestamps are
     * stripped server-side.
     */
    suspend fun exportSettings(): Outcome<String> = runCatchingOutcome {
        supabase.postgrest.rpc("export_my_settings").data
    }

    /** Import a previously-exported settings JSON. */
    suspend fun importSettings(settingsJson: String): Outcome<Unit> = runCatchingOutcome {
        val payload = kotlinx.serialization.json.Json.parseToJsonElement(settingsJson) as?
            kotlinx.serialization.json.JsonObject ?: error("Bad settings payload")
        supabase.postgrest.rpc(
            "import_my_settings",
            kotlinx.serialization.json.buildJsonObject {
                put("p_settings", payload)
            }
        )
        Unit
    }
}
