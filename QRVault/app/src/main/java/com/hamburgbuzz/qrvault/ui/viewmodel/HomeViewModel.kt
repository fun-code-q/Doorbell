package com.hamburgbuzz.qrvault.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hamburgbuzz.qrvault.data.model.DoorPoint
import com.hamburgbuzz.qrvault.data.model.Ring
import com.hamburgbuzz.qrvault.data.repository.RingRepository
import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class Stats(
    val missed: Int = 0,
    val answered: Int = 0,
    val totalDoors: Int = 0,
    val paused: Int = 0,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val supabase: SupabaseClient,
    private val ringRepo: RingRepository,
    private val houses: com.hamburgbuzz.qrvault.data.repository.HouseRepository,
    private val auth: com.hamburgbuzz.qrvault.data.repository.AuthRepository,
) : ViewModel() {

    /** Per-ring debounce state for the Reply button. */
    private val _sendingForRing = MutableStateFlow<Set<String>>(emptySet())
    val sendingForRing: StateFlow<Set<String>> = _sendingForRing

    private val _hasMore = MutableStateFlow(true)
    val hasMore: StateFlow<Boolean> = _hasMore
    private val pageSize = 50

    private val _rings = MutableStateFlow<List<Ring>>(emptyList())
    val rings: StateFlow<List<Ring>> = _rings

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val _stats = MutableStateFlow(Stats())
    val stats: StateFlow<Stats> = _stats

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery

    private val _filterStatus = MutableStateFlow("all")
    val filterStatus: StateFlow<String> = _filterStatus

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun clearError() { _error.value = null }

    val filteredRings: StateFlow<List<Ring>> =
        combine(_rings, _searchQuery, _filterStatus) { rings, query, status ->
            val q = query.lowercase()
            rings.filter { r ->
                val matchesQuery = r.doorLocation.lowercase().contains(q) ||
                                   (r.guestMessage?.lowercase()?.contains(q) ?: false)
                val matchesStatus = when (status) {
                    "all" -> true
                    "waiting" -> r.status == "waiting" || r.status == "acknowledged"
                    "responded" -> r.status == "responded"
                    else -> true
                }
                matchesQuery && matchesStatus
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        loadRings()
        loadDoorStats()
        subscribeToRings()
    }

    fun loadRings() {
        viewModelScope.launch {
            _isLoading.value = true
            when (val outcome = ringRepo.fetchRingsPage(limit = pageSize)) {
                is Outcome.Success -> {
                    _rings.value = outcome.value
                    _hasMore.value = outcome.value.size >= pageSize
                    updateStats()
                }
                is Outcome.Failure -> _error.value = outcome.error.message
            }
            _isLoading.value = false
        }
    }

    /** Cursor-paginated fetch of older rings (Batch F #14). */
    fun loadMore() {
        if (_isLoading.value || !_hasMore.value) return
        val oldest = _rings.value.lastOrNull() ?: return
        viewModelScope.launch {
            _isLoading.value = true
            when (val outcome = ringRepo.fetchRingsPage(
                beforeCreatedAt = oldest.createdAt,
                beforeId = oldest.id,
                limit = pageSize,
            )) {
                is Outcome.Success -> {
                    _rings.value = _rings.value + outcome.value
                    _hasMore.value = outcome.value.size >= pageSize
                    updateStats()
                }
                is Outcome.Failure -> _error.value = outcome.error.message
            }
            _isLoading.value = false
        }
    }

    private fun loadDoorStats() {
        viewModelScope.launch {
            val outcome = runCatchingOutcome {
                supabase.from("door_points").select().decodeList<DoorPoint>()
            }
            when (outcome) {
                is Outcome.Success -> _stats.update {
                    it.copy(
                        totalDoors = outcome.value.size,
                        paused = outcome.value.count { dp -> !dp.isActive },
                    )
                }
                is Outcome.Failure -> _error.value = outcome.error.message
            }
        }
    }

    private fun updateStats() {
        val cur = _rings.value
        _stats.update {
            it.copy(
                missed = cur.count { r -> r.status == "waiting" || r.status == "acknowledged" },
                answered = cur.count { r -> r.status == "responded" },
            )
        }
    }

    private fun subscribeToRings() {
        viewModelScope.launch {
            // Server-side filter (Batch F #12): only subscribe to our houses
            // so we don't receive (and immediately discard) events for other
            // tenants' rings.
            val houseIds = (houses.myHouseIds() as? Outcome.Success)?.value ?: emptyList()
            if (houseIds.isEmpty()) return@launch
            ringRepo.realtimeRings(houseIds).collect { event ->
                when (event) {
                    is RingRepository.RingEvent.Insert ->
                        _rings.value = (listOf(event.ring) + _rings.value).sortedByDescending { it.createdAt }
                    is RingRepository.RingEvent.Update ->
                        _rings.value = _rings.value.map { if (it.id == event.ring.id) event.ring else it }
                    is RingRepository.RingEvent.Delete ->
                        _rings.value = _rings.value.filterNot { it.id == event.id }
                }
                updateStats()
            }
        }
    }

    override fun onCleared() {
        viewModelScope.launch { ringRepo.unsubscribe() }
        super.onCleared()
    }

    /**
     * Send a reply via the offline-safe worker. The button stays disabled
     * for ~3 seconds (debounce) and the worker handles retries on network
     * failure. The server idempotency key prevents double-send.
     */
    fun sendReply(ringId: String, message: String) {
        if (_sendingForRing.value.contains(ringId)) return
        if (message.isBlank()) return
        _sendingForRing.value = _sendingForRing.value + ringId
        com.hamburgbuzz.qrvault.worker.ReplyDispatchWorker.enqueue(context, ringId, message.trim())
        // Optimistic: trust the worker. Clear the lock after a debounce window.
        viewModelScope.launch {
            kotlinx.coroutines.delay(3000)
            _sendingForRing.value = _sendingForRing.value - ringId
        }
    }

    fun deleteRing(ringId: String) {
        viewModelScope.launch {
            ringRepo.deleteRing(ringId).onFailure { _error.value = it.message }
        }
    }

    fun setSearchQuery(q: String) { _searchQuery.value = q }
    fun setFilterStatus(s: String) { _filterStatus.value = s }

    fun signOut() {
        viewModelScope.launch {
            auth.signOut().onFailure { _error.value = it.message }
        }
    }
}
