package com.hamburgbuzz.qrvault.util

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Thin Android Biometric API wrapper. Opt-in: only invoked when the
 * user toggles "Require biometric unlock" in Settings (Batch G #22).
 *
 * Uses BIOMETRIC_STRONG only; device-PIN fallback is allowed via
 * setAllowedAuthenticators so an owner whose phone has a PIN but no
 * fingerprint can still authenticate.
 */
object BiometricGate {

    fun isAvailable(activity: FragmentActivity): Boolean {
        val flags = BiometricManager.Authenticators.BIOMETRIC_STRONG or
                    BiometricManager.Authenticators.DEVICE_CREDENTIAL
        return BiometricManager.from(activity).canAuthenticate(flags) ==
            BiometricManager.BIOMETRIC_SUCCESS
    }

    /** Suspends until the user authenticates. Returns true on success. */
    suspend fun prompt(activity: FragmentActivity, title: String, subtitle: String? = null): Boolean =
        suspendCancellableCoroutine { cont ->
            val executor = ContextCompat.getMainExecutor(activity)
            val prompt = BiometricPrompt(
                activity, executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (cont.isActive) cont.resume(true)
                    }
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        if (cont.isActive) cont.resume(false)
                    }
                    override fun onAuthenticationFailed() {
                        // User got it wrong; the dialog stays open until they cancel or succeed.
                    }
                },
            )
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .apply { subtitle?.let { setSubtitle(it) } }
                .setAllowedAuthenticators(
                    BiometricManager.Authenticators.BIOMETRIC_STRONG
                    or BiometricManager.Authenticators.DEVICE_CREDENTIAL
                )
                .build()
            prompt.authenticate(info)
        }
}
