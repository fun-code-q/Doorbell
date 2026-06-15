package com.hamburgbuzz.qrvault.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hamburgbuzz.qrvault.data.repository.InvitationRepository
import com.hamburgbuzz.qrvault.util.Outcome
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class InvitationsViewModel @Inject constructor(
    private val invites: InvitationRepository,
) : ViewModel() {

    private val _pending = MutableStateFlow<List<InvitationRepository.PendingInvitation>>(emptyList())
    val pending: StateFlow<List<InvitationRepository.PendingInvitation>> = _pending

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun clearError() { _error.value = null }

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _isLoading.value = true
            when (val o = invites.listPendingForMe()) {
                is Outcome.Success -> _pending.value = o.value
                is Outcome.Failure -> _error.value = o.error.message
            }
            _isLoading.value = false
        }
    }

    fun accept(id: String) {
        viewModelScope.launch {
            invites.accept(id).onSuccess { refresh() }.onFailure { _error.value = it.message }
        }
    }

    fun decline(id: String) {
        viewModelScope.launch {
            invites.decline(id).onSuccess { refresh() }.onFailure { _error.value = it.message }
        }
    }
}
