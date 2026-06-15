package com.hamburgbuzz.qrvault.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.messaging.FirebaseMessaging
import com.hamburgbuzz.qrvault.data.repository.DeviceRepository
import com.hamburgbuzz.qrvault.util.Outcome
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

@HiltViewModel
class DevicesViewModel @Inject constructor(
    private val deviceRepo: DeviceRepository,
) : ViewModel() {

    private val _devices = MutableStateFlow<List<DeviceRepository.Device>>(emptyList())
    val devices: StateFlow<List<DeviceRepository.Device>> = _devices

    private val _thisDeviceFcmTokenSuffix = MutableStateFlow<String?>(null)
    val thisDeviceFcmTokenSuffix: StateFlow<String?> = _thisDeviceFcmTokenSuffix

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun clearError() { _error.value = null }

    init {
        refresh()
        captureCurrentDeviceToken()
    }

    fun refresh() {
        viewModelScope.launch {
            _isLoading.value = true
            when (val o = deviceRepo.list()) {
                is Outcome.Success -> _devices.value = o.value
                is Outcome.Failure -> _error.value = o.error.message
            }
            _isLoading.value = false
        }
    }

    fun revoke(deviceId: String) {
        viewModelScope.launch {
            deviceRepo.revoke(deviceId)
                .onSuccess { refresh() }
                .onFailure { _error.value = it.message }
        }
    }

    private fun captureCurrentDeviceToken() {
        viewModelScope.launch {
            runCatching {
                val token = FirebaseMessaging.getInstance().token.await()
                _thisDeviceFcmTokenSuffix.value = token?.takeLast(8)
            }
        }
    }
}
