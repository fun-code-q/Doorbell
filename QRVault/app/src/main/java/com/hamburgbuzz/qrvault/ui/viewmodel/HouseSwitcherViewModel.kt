package com.hamburgbuzz.qrvault.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hamburgbuzz.qrvault.data.repository.HouseRepository
import com.hamburgbuzz.qrvault.util.Outcome
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Drives the house-switcher dropdown in the Home top bar.
 *
 * Loads:
 *   * houses           — all houses the user is a member of
 *   * activeHouseId    — current selection from owner_settings
 *
 * Switching is a single RPC call + a refresh of activeHouseId. Home's
 * realtime / pagination repos pick up the new active house on their own
 * next refresh.
 */
@HiltViewModel
class HouseSwitcherViewModel @Inject constructor(
    private val houseRepo: HouseRepository,
    private val supabase: SupabaseClient,
) : ViewModel() {

    private val _houses = MutableStateFlow<List<HouseRepository.HouseSummary>>(emptyList())
    val houses: StateFlow<List<HouseRepository.HouseSummary>> = _houses

    private val _activeHouseId = MutableStateFlow<String?>(null)
    val activeHouseId: StateFlow<String?> = _activeHouseId

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            when (val outcome = houseRepo.listHouses()) {
                is Outcome.Success -> _houses.value = outcome.value
                is Outcome.Failure -> Unit  // silently fail; old list stays
            }
            // Pull active_house_id directly to avoid coupling to SettingsViewModel.
            runCatching {
                supabase.from("owner_settings").select().decodeSingleOrNull<ActiveHouseRow>()
            }.onSuccess { _activeHouseId.value = it?.activeHouseId }
        }
    }

    fun switchTo(houseId: String, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            when (houseRepo.switchActiveHouse(houseId)) {
                is Outcome.Success -> {
                    _activeHouseId.value = houseId
                    onDone()
                }
                is Outcome.Failure -> Unit
            }
        }
    }

    @kotlinx.serialization.Serializable
    private data class ActiveHouseRow(
        @kotlinx.serialization.SerialName("active_house_id")
        val activeHouseId: String? = null,
    )
}
