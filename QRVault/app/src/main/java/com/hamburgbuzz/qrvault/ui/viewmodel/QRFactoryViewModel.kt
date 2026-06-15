package com.hamburgbuzz.qrvault.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hamburgbuzz.qrvault.BuildConfig
import com.hamburgbuzz.qrvault.data.model.DoorPoint
import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.net.URLEncoder
import javax.inject.Inject

@HiltViewModel
class QRFactoryViewModel @Inject constructor(
    private val supabase: SupabaseClient,
) : ViewModel() {

    private val _doorPoints = MutableStateFlow<List<DoorPoint>>(emptyList())
    val doorPoints: StateFlow<List<DoorPoint>> = _doorPoints

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val _selectedDoor = MutableStateFlow<DoorPoint?>(null)
    val selectedDoor: StateFlow<DoorPoint?> = _selectedDoor

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun clearError() { _error.value = null }

    init { loadDoors() }

    fun loadDoors() {
        viewModelScope.launch {
            _isLoading.value = true
            val outcome = runCatchingOutcome {
                supabase.from("door_points").select().decodeList<DoorPoint>()
            }
            when (outcome) {
                is Outcome.Success -> _doorPoints.value = outcome.value
                is Outcome.Failure -> _error.value = outcome.error.message
            }
            _isLoading.value = false
        }
    }

    fun selectDoor(door: DoorPoint) { _selectedDoor.value = door }

    fun guestUrl(qrToken: String): String =
        BuildConfig.GUEST_BASE_URL.trimEnd('/') + "/?t=" + qrToken

    /**
     * Returns a QR-image URL. We generate it client-side using the
     * deprecated-but-still-stable Google Chart API for now; the long-term
     * plan is to render the QR locally with ZXing so we don't depend on
     * an external service or its uptime.
     */
    fun qrImageUrl(guestUrl: String): String =
        "https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${URLEncoder.encode(guestUrl, Charsets.UTF_8)}"
}
