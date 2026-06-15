package com.hamburgbuzz.qrvault.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hamburgbuzz.qrvault.data.repository.AuthRepository
import com.hamburgbuzz.qrvault.data.repository.HouseRepository
import com.hamburgbuzz.qrvault.data.repository.WebhookRepository
import com.hamburgbuzz.qrvault.util.Outcome
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class WebhooksViewModel @Inject constructor(
    private val auth: AuthRepository,
    private val houses: HouseRepository,
    private val webhooks: WebhookRepository,
) : ViewModel() {

    private val _hooks = MutableStateFlow<List<WebhookRepository.Webhook>>(emptyList())
    val hooks: StateFlow<List<WebhookRepository.Webhook>> = _hooks

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val _activeHouseId = MutableStateFlow<String?>(null)
    val activeHouseId: StateFlow<String?> = _activeHouseId

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun clearError() { _error.value = null }

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _isLoading.value = true
            when (val o = auth.ensureOwnerHouse()) {
                is Outcome.Success -> {
                    _activeHouseId.value = o.value
                    when (val w = webhooks.list(o.value)) {
                        is Outcome.Success -> _hooks.value = w.value
                        is Outcome.Failure -> _error.value = w.error.message
                    }
                }
                is Outcome.Failure -> _error.value = o.error.message
            }
            _isLoading.value = false
        }
    }

    fun add(url: String, secret: String, description: String?) {
        val hid = _activeHouseId.value ?: return
        viewModelScope.launch {
            webhooks.create(hid, url.trim(), secret.trim(), description?.trim()?.ifBlank { null })
                .onSuccess { refresh() }
                .onFailure { _error.value = it.message }
        }
    }

    fun setActive(id: String, active: Boolean) {
        viewModelScope.launch {
            webhooks.setActive(id, active)
                .onSuccess { refresh() }
                .onFailure { _error.value = it.message }
        }
    }

    fun remove(id: String) {
        viewModelScope.launch {
            webhooks.delete(id)
                .onSuccess { refresh() }
                .onFailure { _error.value = it.message }
        }
    }
}
