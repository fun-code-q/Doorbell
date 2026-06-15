package com.hamburgbuzz.qrvault.ui.viewmodel

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.messaging.FirebaseMessaging
import com.hamburgbuzz.qrvault.data.model.House
import com.hamburgbuzz.qrvault.data.model.OwnerSettings
import com.hamburgbuzz.qrvault.data.repository.AuthRepository
import com.hamburgbuzz.qrvault.data.repository.OwnerKeyRepository
import com.hamburgbuzz.qrvault.data.repository.PushRepository
import com.hamburgbuzz.qrvault.util.Outcome
import com.hamburgbuzz.qrvault.util.runCatchingOutcome
import com.hamburgbuzz.qrvault.worker.PushTokenSyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val supabase: SupabaseClient,
    private val auth: AuthRepository,
    private val push: PushRepository,
    private val ownerKeys: OwnerKeyRepository,
    private val backups: com.hamburgbuzz.qrvault.data.repository.KeyBackupRepository,
    private val customization: com.hamburgbuzz.qrvault.data.repository.CustomizationRepository,
) : ViewModel() {

    private val _availableBackups = MutableStateFlow<List<com.hamburgbuzz.qrvault.data.repository.KeyBackupRepository.Backup>>(emptyList())
    val availableBackups: StateFlow<List<com.hamburgbuzz.qrvault.data.repository.KeyBackupRepository.Backup>> = _availableBackups

    private val _settings = MutableStateFlow<OwnerSettings?>(null)
    val settings: StateFlow<OwnerSettings?> = _settings

    private val _houses = MutableStateFlow<List<House>>(emptyList())
    val houses: StateFlow<List<House>> = _houses

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun clearError() { _error.value = null }

    init { loadData() }

    private fun loadData() {
        viewModelScope.launch {
            _isLoading.value = true
            val housesOutcome = runCatchingOutcome {
                supabase.from("houses").select().decodeList<House>()
            }
            (housesOutcome as? Outcome.Success)?.let { _houses.value = it.value }
            (housesOutcome as? Outcome.Failure)?.let { _error.value = it.error.message }

            val userId = auth.currentUserId() ?: "default"
            val settingsOutcome = runCatchingOutcome {
                supabase.from("owner_settings").select {
                    filter { eq("user_id", userId) }
                }.decodeSingleOrNull<OwnerSettings>()
            }
            when (settingsOutcome) {
                is Outcome.Success -> {
                    val s = settingsOutcome.value ?: OwnerSettings(userId = userId)
                    _settings.value = s
                    // Cache quick replies so IncomingRingActivity can read
                    // them synchronously on next FCM wake (Batch M #3).
                    com.hamburgbuzz.qrvault.util.QuickReplyCache.save(context, s.quickReplies)
                }
                is Outcome.Failure -> _error.value = settingsOutcome.error.message
            }
            _isLoading.value = false
        }
    }

    /** Set the owner's custom quick replies (max 5). Empty list / null clears. */
    fun setQuickReplies(replies: List<String>?) {
        viewModelScope.launch {
            customization.setQuickReplies(replies)
                .onSuccess {
                    _settings.value = _settings.value?.copy(quickReplies = replies)
                    com.hamburgbuzz.qrvault.util.QuickReplyCache.save(context, replies)
                }
                .onFailure { _error.value = it.message }
        }
    }

    fun setDisplayName(name: String?) {
        viewModelScope.launch {
            customization.setDisplayName(name).onFailure { _error.value = it.message }
        }
    }

    fun setHouseWelcome(houseId: String, welcome: String?) {
        viewModelScope.launch {
            customization.setHouseWelcome(houseId, welcome).onFailure { _error.value = it.message }
        }
    }

    fun updateSettings(newSettings: OwnerSettings) {
        viewModelScope.launch {
            val outcome = runCatchingOutcome { supabase.from("owner_settings").upsert(newSettings) }
            when (outcome) {
                is Outcome.Success -> {
                    _settings.value = newSettings
                    AppCompatDelegate.setApplicationLocales(
                        LocaleListCompat.forLanguageTags(newSettings.language)
                    )
                }
                is Outcome.Failure -> _error.value = outcome.error.message
            }
        }
    }

    fun changeHouse(houseId: String) {
        val current = _settings.value ?: return
        updateSettings(current.copy(activeHouseId = houseId))
        viewModelScope.launch {
            ownerKeys.publishPublicKeyFor(houseId)
        }
    }

    /**
     * Force a re-sync of the FCM token to Supabase. Useful for the
     * Power-User wizard / "Push not working?" troubleshooter.
     */
    fun syncFcmToken() {
        viewModelScope.launch {
            runCatching {
                val token = FirebaseMessaging.getInstance().token.await()
                if (!token.isNullOrBlank()) {
                    PushTokenSyncWorker.enqueue(context, token)
                }
            }.onFailure { _error.value = it.message }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            runCatching {
                val token = FirebaseMessaging.getInstance().token.await()
                if (!token.isNullOrBlank()) push.deactivateToken(token)
            }
            ownerKeys.rotateLocal()
            auth.signOut().onFailure { _error.value = it.message }
        }
    }

    // ---- Encrypted-keypair backup (Batch A #2) ---------------------------

    fun loadBackups() {
        viewModelScope.launch {
            backups.listBackups()
                .onSuccess { _availableBackups.value = it }
                .onFailure { _error.value = it.message }
        }
    }

    /**
     * Wrap this device's private key with `passphrase` and upload to
     * Supabase. The passphrase is zeroed by the caller after this returns;
     * we do not retain it.
     */
    fun createBackup(passphrase: CharArray, onDone: (Boolean) -> Unit) {
        val houseId = _settings.value?.activeHouseId
        if (houseId == null) {
            _error.value = "Pick an active house before creating a backup"
            onDone(false); return
        }
        viewModelScope.launch {
            backups.publishBackup(houseId, passphrase, "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                .onSuccess { onDone(true) }
                .onFailure { _error.value = it.message; onDone(false) }
        }
    }

    /**
     * Try to restore the given backup with `passphrase`. On success the
     * local keypair is replaced and the new public key is republished
     * so guests immediately encrypt to it.
     */
    fun restoreBackup(
        backup: com.hamburgbuzz.qrvault.data.repository.KeyBackupRepository.Backup,
        passphrase: CharArray,
        onDone: (Boolean) -> Unit,
    ) {
        viewModelScope.launch {
            backups.restoreFromBackup(backup, passphrase)
                .onSuccess { pubKey ->
                    ownerKeys.publishPublicKeyFor(backup.houseId)
                    onDone(true)
                }
                .onFailure { _error.value = it.message; onDone(false) }
        }
    }

    /**
     * The currently signed-in user's email address. Surfaced so Settings
     * can display it next to the "Change email" row.
     */
    fun currentEmail(): String? = auth.currentUserEmail()

    /**
     * Request an email change. Supabase emails a confirmation link to the
     * NEW address; the change is not effective until the user clicks
     * through. `onDone(true)` means the request was accepted, not that
     * the change has applied.
     */
    fun changeEmail(newEmail: String, onDone: (Boolean) -> Unit) {
        if (newEmail.isBlank() || !newEmail.contains("@")) {
            _error.value = "Enter a valid email address."
            onDone(false); return
        }
        viewModelScope.launch {
            when (val out = auth.updateEmail(newEmail)) {
                is Outcome.Success -> onDone(true)
                is Outcome.Failure -> { _error.value = out.error.message; onDone(false) }
            }
        }
    }

    /**
     * Export owner_settings as a JSON string. Hands the blob back via
     * `onResult` so the screen can write it to whatever URI the file
     * picker returned. Null on failure (error is surfaced via _error).
     */
    fun exportSettings(onResult: (String?) -> Unit) {
        viewModelScope.launch {
            when (val out = auth.exportSettings()) {
                is Outcome.Success -> onResult(out.value)
                is Outcome.Failure -> { _error.value = out.error.message; onResult(null) }
            }
        }
    }

    /** Import a previously-exported settings JSON blob. */
    fun importSettings(json: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            when (val out = auth.importSettings(json)) {
                is Outcome.Success -> { loadData(); onDone(true) }
                is Outcome.Failure -> { _error.value = out.error.message; onDone(false) }
            }
        }
    }

    /**
     * Permanent account deletion (Batch E #7). Triggers server-side
     * cascade across `public.*` and `auth.users`. After this returns
     * successfully we sign out locally and wipe device-resident keys.
     */
    fun deleteAccount(onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            when (val outcome = auth.deleteMyAccount()) {
                is Outcome.Success -> {
                    runCatching {
                        val token = FirebaseMessaging.getInstance().token.await()
                        if (!token.isNullOrBlank()) push.deactivateToken(token)
                    }
                    ownerKeys.rotateLocal()
                    auth.signOut()
                    onDone(true)
                }
                is Outcome.Failure -> { _error.value = outcome.error.message; onDone(false) }
            }
        }
    }
}
