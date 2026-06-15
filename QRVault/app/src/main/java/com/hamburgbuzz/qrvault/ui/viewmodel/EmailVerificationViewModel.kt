package com.hamburgbuzz.qrvault.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hamburgbuzz.qrvault.data.repository.AuthRepository
import com.hamburgbuzz.qrvault.util.Outcome
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Surface for the EmailVerificationBanner. Refreshes when the underlying
 * Supabase session changes — the moment the user clicks the confirmation
 * link on this device, supabase.auth.sessionStatus emits and our `state`
 * recomputes with confirmed = true, hiding the banner.
 */
@HiltViewModel
class EmailVerificationViewModel @Inject constructor(
    private val auth: AuthRepository,
) : ViewModel() {

    data class State(val email: String?, val confirmed: Boolean)

    val state: StateFlow<State> = auth.emailConfirmed
        .map { State(email = auth.currentUserEmail(), confirmed = it) }
        .stateIn(
            viewModelScope,
            SharingStarted.Eagerly,
            State(email = auth.currentUserEmail(), confirmed = auth.isEmailConfirmed()),
        )

    fun resend(onDone: (Boolean) -> Unit) {
        val email = auth.currentUserEmail()
        if (email.isNullOrBlank()) { onDone(false); return }
        viewModelScope.launch {
            when (auth.resendEmailConfirmation(email)) {
                is Outcome.Success -> onDone(true)
                is Outcome.Failure -> onDone(false)
            }
        }
    }
}
