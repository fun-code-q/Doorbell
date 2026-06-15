package com.hamburgbuzz.qrvault.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.messaging.FirebaseMessaging
import com.hamburgbuzz.qrvault.data.repository.AuthRepository
import com.hamburgbuzz.qrvault.data.repository.OwnerKeyRepository
import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.worker.PushTokenSyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val auth: AuthRepository,
    private val ownerKeys: OwnerKeyRepository,
) : ViewModel() {

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    private val _isSignUp = MutableStateFlow(false)
    val isSignUp: StateFlow<Boolean> = _isSignUp

    val isAuthenticated: StateFlow<Boolean> =
        auth.isAuthenticated.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    val isCheckingSession: StateFlow<Boolean> =
        auth.isInitialised.map { !it }.stateIn(viewModelScope, SharingStarted.Eagerly, true)

    fun clearError() { _error.value = null }

    fun toggleMode() {
        _isSignUp.value = !_isSignUp.value
        _error.value = null
    }

    // --------------------------------------------------------------
    // Brute-force protection (client-side soft lockout).
    //
    // Supabase rate-limits at the backend, but we add an in-app cooldown
    // so an attacker can't pin the device's CPU spamming sign-in attempts
    // and so a user who fat-fingers their password three times sees a
    // clear "wait 30 s" prompt instead of vague backend errors.
    //
    // Window is 60 s, threshold 5 attempts, cooldown 30 s. Reset on
    // success.
    // --------------------------------------------------------------
    private val attemptTimestamps = ArrayDeque<Long>()
    private val _lockoutUntilMs = MutableStateFlow(0L)
    val lockoutUntilMs: StateFlow<Long> = _lockoutUntilMs

    private fun registerAttempt(): Long {
        val now = System.currentTimeMillis()
        // Drop attempts older than 60 s.
        while (attemptTimestamps.isNotEmpty() && now - attemptTimestamps.first() > 60_000L) {
            attemptTimestamps.removeFirst()
        }
        attemptTimestamps.addLast(now)
        return if (attemptTimestamps.size >= 5) now + 30_000L else 0L
    }

    fun authenticate(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) {
            _error.value = "Please enter email and password"
            return
        }
        val now = System.currentTimeMillis()
        if (_lockoutUntilMs.value > now) {
            val remaining = ((_lockoutUntilMs.value - now) / 1000).coerceAtLeast(1)
            _error.value = "Too many attempts. Try again in ${remaining}s."
            return
        }
        viewModelScope.launch {
            _isLoading.value = true
            _error.value = null
            val outcome = if (_isSignUp.value) auth.signUp(email, password)
                          else                 auth.signIn(email, password)
            when (outcome) {
                is Outcome.Success -> {
                    attemptTimestamps.clear()
                    _lockoutUntilMs.value = 0L
                    if (_isSignUp.value) {
                        _error.value = "Vault created! Please check your email, then sign in."
                        _isSignUp.value = false
                    } else {
                        finalizeFirstSession()
                    }
                }
                is Outcome.Failure -> {
                    val until = registerAttempt()
                    if (until > 0L) _lockoutUntilMs.value = until
                    _error.value = outcome.error.message
                }
            }
            _isLoading.value = false
        }
    }

    // --------------------------------------------------------------
    // Forgot-password flow.
    //
    // resetPasswordForEmail sends the user an email whose link is our
    // `qrvault://auth/reset` deep link (MainActivity intercepts and
    // routes to ResetPasswordScreen, which calls updatePassword).
    // --------------------------------------------------------------
    fun sendPasswordReset(email: String, onDone: (Boolean) -> Unit) {
        if (email.isBlank()) {
            _error.value = "Please enter your email."
            onDone(false); return
        }
        viewModelScope.launch {
            _isLoading.value = true
            _error.value = null
            val out = auth.resetPasswordForEmail(
                email = email,
                redirectUrl = "qrvault://auth/reset",
            )
            _isLoading.value = false
            when (out) {
                is Outcome.Success -> onDone(true)
                is Outcome.Failure -> { _error.value = out.error.message; onDone(false) }
            }
        }
    }

    fun consumeRecoveryUrl(url: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            when (val out = auth.consumeRecoveryUrl(url)) {
                is Outcome.Success -> onDone(true)
                is Outcome.Failure -> { _error.value = out.error.message; onDone(false) }
            }
        }
    }

    fun updatePassword(newPassword: String, onDone: (Boolean) -> Unit) {
        if (newPassword.length < 8) {
            _error.value = "Password must be at least 8 characters."
            onDone(false); return
        }
        viewModelScope.launch {
            _isLoading.value = true
            when (val out = auth.updatePassword(newPassword)) {
                is Outcome.Success -> onDone(true)
                is Outcome.Failure -> { _error.value = out.error.message; onDone(false) }
            }
            _isLoading.value = false
        }
    }

    fun resendEmailConfirmation(email: String, onDone: (Boolean) -> Unit) {
        if (email.isBlank()) { onDone(false); return }
        viewModelScope.launch {
            when (val out = auth.resendEmailConfirmation(email)) {
                is Outcome.Success -> onDone(true)
                is Outcome.Failure -> { _error.value = out.error.message; onDone(false) }
            }
        }
    }

    /**
     * Runs after a successful sign-in: ensures the user owns a house,
     * publishes the device's public key for guest encryption, and kicks
     * off an FCM token sync so the device starts receiving rings even
     * if it's the first launch on this account.
     */
    private suspend fun finalizeFirstSession() {
        val houseOutcome = auth.ensureOwnerHouse()
        val houseId = (houseOutcome as? Outcome.Success)?.value
        if (houseId != null) {
            ownerKeys.publishPublicKeyFor(
                houseId = houseId,
                deviceLabel = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}",
            )
        }
        runCatching {
            val token = FirebaseMessaging.getInstance().token.await()
            if (!token.isNullOrBlank()) {
                PushTokenSyncWorker.enqueue(context, token)
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            auth.signOut()
            // Wipe the libsodium keypair so the next user gets a fresh one.
            ownerKeys.rotateLocal()
        }
    }
}
