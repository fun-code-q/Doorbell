package com.hamburgbuzz.qrvault.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hamburgbuzz.qrvault.BuildConfig
import com.hamburgbuzz.qrvault.data.model.DoorMember
import com.hamburgbuzz.qrvault.data.model.DoorPoint
import com.hamburgbuzz.qrvault.data.model.UserProfile
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
class DoorsViewModel @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val supabase: SupabaseClient,
    private val auth: AuthRepository,
    private val doors: com.hamburgbuzz.qrvault.data.repository.DoorRepository,
    private val invites: com.hamburgbuzz.qrvault.data.repository.InvitationRepository,
    private val geocode: com.hamburgbuzz.qrvault.data.repository.GeocodeRepository,
    private val customization: com.hamburgbuzz.qrvault.data.repository.CustomizationRepository,
) : ViewModel() {

    private val _doorPoints = MutableStateFlow<List<DoorPoint>>(emptyList())
    val doorPoints: StateFlow<List<DoorPoint>> = _doorPoints

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val _currentHouseId = MutableStateFlow<String?>(null)
    val currentHouseId: StateFlow<String?> = _currentHouseId

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    private val _doorMembers = MutableStateFlow<Map<String, List<DoorMember>>>(emptyMap())
    val doorMembers: StateFlow<Map<String, List<DoorMember>>> = _doorMembers

    init { ensureHouseContext() }

    fun clearError() { _error.value = null }

    private fun ensureHouseContext() {
        viewModelScope.launch {
            _isLoading.value = true
            when (val outcome = auth.ensureOwnerHouse()) {
                is Outcome.Success -> {
                    _currentHouseId.value = outcome.value
                    loadDoorPoints(outcome.value)
                }
                is Outcome.Failure -> _error.value = outcome.error.message
            }
            _isLoading.value = false
        }
    }

    fun loadDoorPoints(houseId: String) {
        viewModelScope.launch {
            _isLoading.value = true
            val outcome = runCatchingOutcome {
                supabase.from("door_points").select {
                    filter { eq("house_id", houseId) }
                    order("name", order = Order.ASCENDING)
                }.decodeList<DoorPoint>()
            }
            when (outcome) {
                is Outcome.Success -> _doorPoints.value = outcome.value
                is Outcome.Failure -> _error.value = outcome.error.message
            }
            _isLoading.value = false
        }
    }

    fun addDoorPoint(name: String, description: String, lat: Double? = null, lon: Double? = null) {
        val houseId = _currentHouseId.value ?: return
        viewModelScope.launch {
            val outcome = runCatchingOutcome {
                supabase.from("door_points").insert(
                    mapOf(
                        "house_id"           to houseId,
                        "name"               to name,
                        "description"        to description.ifBlank { null },
                        "latitude"           to lat,
                        "longitude"          to lon,
                    )
                ) { select() }.decodeSingle<DoorPoint>()
            }
            when (outcome) {
                is Outcome.Success -> _doorPoints.value = (_doorPoints.value + outcome.value).sortedBy { it.name }
                is Outcome.Failure -> _error.value = outcome.error.message
            }
        }
    }

    fun updateDoorPoint(id: String, name: String, description: String) {
        val houseId = _currentHouseId.value ?: return
        viewModelScope.launch {
            val outcome = runCatchingOutcome {
                supabase.from("door_points").update(
                    mapOf("name" to name, "description" to description.ifBlank { null })
                ) {
                    filter { eq("id", id) }
                    select()
                }.decodeSingle<DoorPoint>()
            }
            when (outcome) {
                is Outcome.Success -> _doorPoints.value =
                    _doorPoints.value.map { if (it.id == id) outcome.value else it }.sortedBy { it.name }
                is Outcome.Failure -> _error.value = outcome.error.message
            }
        }
    }

    fun setDoorPointActive(id: String, isActive: Boolean) {
        val houseId = _currentHouseId.value ?: return
        viewModelScope.launch {
            runCatchingOutcome {
                supabase.from("door_points").update(mapOf("is_active" to isActive)) {
                    filter { eq("id", id) }
                }
            }.onFailure { _error.value = it.message }
            loadDoorPoints(houseId)
        }
    }

    fun deleteDoorPoint(id: String) {
        val houseId = _currentHouseId.value ?: return
        viewModelScope.launch {
            runCatchingOutcome {
                supabase.from("door_points").delete { filter { eq("id", id) } }
            }.onFailure { _error.value = it.message }
            loadDoorPoints(houseId)
        }
    }

    fun loadDoorMembers(doorId: String) {
        viewModelScope.launch {
            val outcome = runCatchingOutcome {
                supabase.from("door_point_members").select {
                    filter { eq("door_point_id", doorId) }
                }.decodeList<DoorMember>()
            }
            when (outcome) {
                is Outcome.Success -> _doorMembers.value = _doorMembers.value + (doorId to outcome.value)
                is Outcome.Failure -> _error.value = outcome.error.message
            }
        }
    }

    fun addDoorMember(doorId: String, username: String) {
        viewModelScope.launch {
            val outcome = runCatchingOutcome {
                val profile = supabase.from("profiles").select {
                    filter { eq("username", username) }
                }.decodeSingle<UserProfile>()
                supabase.from("door_point_members").insert(
                    mapOf("door_point_id" to doorId, "user_id" to profile.id)
                )
            }
            outcome.onFailure { _error.value = it.message }
            loadDoorMembers(doorId)
        }
    }

    fun removeDoorMember(doorId: String, userId: String) {
        viewModelScope.launch {
            runCatchingOutcome {
                supabase.from("door_point_members").delete {
                    filter { eq("door_point_id", doorId); eq("user_id", userId) }
                }
            }.onFailure { _error.value = it.message }
            loadDoorMembers(doorId)
        }
    }

    fun muteDoorMember(doorId: String, userId: String, isMuted: Boolean) {
        viewModelScope.launch {
            runCatchingOutcome {
                supabase.from("door_point_members").update(mapOf("is_muted" to isMuted)) {
                    filter { eq("door_point_id", doorId); eq("user_id", userId) }
                }
            }.onFailure { _error.value = it.message }
            loadDoorMembers(doorId)
        }
    }

    fun guestUrl(qrToken: String): String =
        BuildConfig.GUEST_BASE_URL.trimEnd('/') + "/?t=" + qrToken

    /**
     * One-tap "kill this leaked sticker". Generates a new qr_token; the
     * old printed QR code is dead immediately because resolve_qr_token
     * only matches the current token.
     */
    fun rotateQrToken(doorId: String) {
        val houseId = _currentHouseId.value ?: return
        viewModelScope.launch {
            doors.rotateQrToken(doorId)
                .onSuccess { loadDoorPoints(houseId) }
                .onFailure { _error.value = it.message }
        }
    }

    /**
     * Captures the current device location with FusedLocationProvider and
     * pins it as this door's geofence anchor. Requires ACCESS_FINE_LOCATION
     * to have been granted at the screen level. Owner must be physically
     * at the door for the anchor to be useful.
     */
    fun pinCurrentLocation(doorId: String, radiusMeters: Int = 50) {
        val houseId = _currentHouseId.value ?: return
        viewModelScope.launch {
            val fix = com.hamburgbuzz.qrvault.util.LocationCapture.current(context)
            if (fix == null) {
                _error.value = "Could not get a GPS fix — make sure location is enabled and you're at the door."
                return@launch
            }
            doors.setLocation(
                doorPointId = doorId,
                latitude = fix.latitude,
                longitude = fix.longitude,
                radiusM = radiusMeters,
                accuracyM = fix.accuracyM,
            )
                .onSuccess { loadDoorPoints(houseId) }
                .onFailure { _error.value = it.message }
        }
    }

    // ------------------------------------------------------------------
    // Geocode → pin
    // ------------------------------------------------------------------
    data class GeocodePreview(
        val latitude: Double,
        val longitude: Double,
        val displayName: String?,
        val confidence: Double?,
    )

    private val _geocodePreview = MutableStateFlow<GeocodePreview?>(null)
    val geocodePreview: StateFlow<GeocodePreview?> = _geocodePreview

    private val _geocoding = MutableStateFlow(false)
    val geocoding: StateFlow<Boolean> = _geocoding

    fun clearGeocodePreview() { _geocodePreview.value = null }

    /**
     * Forward-geocode an address (no auto-write). The result is stashed
     * in `geocodePreview` so the SecurityDialog can show a confirm step
     * before overwriting the door's anchor.
     */
    fun lookupAddress(address: String) {
        if (address.isBlank()) return
        viewModelScope.launch {
            _geocoding.value = true
            when (val out = geocode.geocode(address)) {
                is Outcome.Success -> _geocodePreview.value = GeocodePreview(
                    latitude = out.value.latitude,
                    longitude = out.value.longitude,
                    displayName = out.value.displayName,
                    confidence = out.value.confidence,
                )
                is Outcome.Failure -> _error.value = out.error.message
            }
            _geocoding.value = false
        }
    }

    /** Confirm the geocoded preview: writes it to door_points. */
    fun applyGeocodedPin(doorId: String, radiusMeters: Int) {
        val houseId = _currentHouseId.value ?: return
        val preview = _geocodePreview.value ?: return
        viewModelScope.launch {
            doors.setLocation(
                doorPointId = doorId,
                latitude = preview.latitude,
                longitude = preview.longitude,
                radiusM = radiusMeters,
                // Geocoded coords have no GPS accuracy — leave null so the
                // server doesn't claim a precision it can't justify.
                accuracyM = null,
            )
                .onSuccess {
                    _geocodePreview.value = null
                    loadDoorPoints(houseId)
                }
                .onFailure { _error.value = it.message }
        }
    }

    // ------------------------------------------------------------------
    // Ringtone
    // ------------------------------------------------------------------
    /**
     * `null` → revert to bundled default. Other valid values:
     * `"system:default"`, `"bundled:soft"`, `"bundled:chime"`, `"bundled:buzz"`.
     */
    fun setRingtone(doorId: String, identifier: String?) {
        val houseId = _currentHouseId.value ?: return
        viewModelScope.launch {
            customization.setDoorRingtone(doorId, identifier)
                .onSuccess { loadDoorPoints(houseId) }
                .onFailure { _error.value = it.message }
        }
    }

    /** Owner manually pauses ring delivery for `minutes` (0 = clear DND). */
    fun setDnd(doorId: String, minutes: Int) {
        val houseId = _currentHouseId.value ?: return
        viewModelScope.launch {
            doors.setDnd(doorId, minutes)
                .onSuccess { loadDoorPoints(houseId) }
                .onFailure { _error.value = it.message }
        }
    }

    /**
     * Configure quiet hours for a door. Pass nulls to clear the schedule.
     * Minutes since local midnight (0..1440); wrapping ranges supported
     * (e.g. 22*60..7*60 = 22:00..07:00 next day).
     */
    fun setQuietHours(doorId: String, startMin: Int?, endMin: Int?) {
        val houseId = _currentHouseId.value ?: return
        viewModelScope.launch {
            doors.setQuietHours(doorId, startMin, endMin)
                .onSuccess { loadDoorPoints(houseId) }
                .onFailure { _error.value = it.message }
        }
    }

    /**
     * Invite someone to the active house by email (Batch B #3). The
     * invitee receives an FCM push (if they're already a user) and the
     * invitation lands in their pending list on next sign-in.
     */
    fun inviteMember(email: String, role: String = "manager", onDone: (Boolean) -> Unit = {}) {
        val houseId = _currentHouseId.value
        if (houseId == null) { _error.value = "No active house"; onDone(false); return }
        viewModelScope.launch {
            invites.invite(houseId, email, role)
                .onSuccess { onDone(true) }
                .onFailure { _error.value = it.message; onDone(false) }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            auth.signOut().onFailure { _error.value = it.message }
        }
    }
}
