package com.hamburgbuzz.qrvault.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hamburgbuzz.qrvault.data.model.AuditEntry
import com.hamburgbuzz.qrvault.data.repository.AuthRepository
import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AuditViewModel @Inject constructor(
    private val supabase: SupabaseClient,
    private val auth: AuthRepository,
) : ViewModel() {

    private val _auditEntries = MutableStateFlow<List<AuditEntry>>(emptyList())
    val auditEntries: StateFlow<List<AuditEntry>> = _auditEntries

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val _currentHouseId = MutableStateFlow<String?>(null)

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun clearError() { _error.value = null }

    init { bootstrap() }

    private fun bootstrap() {
        viewModelScope.launch {
            when (val outcome = auth.ensureOwnerHouse()) {
                is Outcome.Success -> {
                    _currentHouseId.value = outcome.value
                    loadAuditLog(outcome.value)
                }
                is Outcome.Failure -> _error.value = outcome.error.message
            }
        }
    }

    fun loadAuditLog(houseId: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val outcome = runCatchingOutcome {
                supabase.from("audit_log").select {
                    filter { eq("house_id", houseId) }
                    order("created_at", order = Order.DESCENDING)
                }.decodeList<AuditEntry>()
            }
            when (outcome) {
                is Outcome.Success -> _auditEntries.value = outcome.value
                is Outcome.Failure -> _error.value = outcome.error.message
            }
            _isLoading.value = false
        }
    }

    fun clearAuditLog() {
        val houseId = _currentHouseId.value ?: return
        viewModelScope.launch {
            runCatchingOutcome {
                supabase.from("audit_log").delete { filter { eq("house_id", houseId) } }
            }.onSuccess { _auditEntries.value = emptyList() }
             .onFailure { _error.value = it.message }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            auth.signOut().onFailure { _error.value = it.message }
        }
    }
}
