package com.hamburgbuzz.qrvault.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hamburgbuzz.qrvault.util.HealthCheck
import com.hamburgbuzz.qrvault.util.RingHealthCheck
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HealthViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
) : ViewModel() {

    private val _checks = MutableStateFlow<List<HealthCheck>>(emptyList())
    val checks: StateFlow<List<HealthCheck>> = _checks

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _isLoading.value = true
            _checks.value = RingHealthCheck.runAll(context)
            _isLoading.value = false
        }
    }
}
