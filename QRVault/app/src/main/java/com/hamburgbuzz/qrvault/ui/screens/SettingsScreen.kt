package com.hamburgbuzz.qrvault.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ReplyAll
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.EmojiPeople
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.HealthAndSafety
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.ui.res.stringResource
import com.hamburgbuzz.qrvault.R
import com.hamburgbuzz.qrvault.ui.components.ShimmerList
import com.hamburgbuzz.qrvault.ui.theme.*
import com.hamburgbuzz.qrvault.ui.viewmodel.SettingsViewModel
import com.hamburgbuzz.qrvault.util.AndroidSettingsHelper
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateBack: () -> Unit,
    onSignOut: () -> Unit,
    onNavigateToHealth: () -> Unit = {},
    onNavigateToDevices: () -> Unit = {},
    onNavigateToInvitations: () -> Unit = {},
    onNavigateToAbout: () -> Unit = {},
    onNavigateToWebhooks: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()

    // Dialog-open state for the four Personalization rows. Each is a small
    // sealed state machine; rememberSaveable keeps them across rotation.
    var showDisplayNameDialog by rememberSaveable { mutableStateOf(false) }
    var showWelcomeDialog by rememberSaveable { mutableStateOf(false) }
    var showQuickRepliesDialog by rememberSaveable { mutableStateOf(false) }

    val context = LocalContext.current
    var crashOptIn by rememberSaveable {
        mutableStateOf(com.hamburgbuzz.qrvault.util.CrashReporting.isEnabled(context))
    }
    var appLockEnabled by rememberSaveable {
        mutableStateOf(com.hamburgbuzz.qrvault.util.AppLockPrefs.isEnabled(context))
    }
    val biometricAvailable = remember {
        (context as? androidx.fragment.app.FragmentActivity)?.let {
            com.hamburgbuzz.qrvault.util.BiometricGate.isAvailable(it)
        } ?: false
    }
    val appLockScope = rememberCoroutineScope()
    
    LaunchedEffect(error) {
        error?.let {
            Toast.makeText(context, it, Toast.LENGTH_LONG).show()
            viewModel.clearError()
        }
    }
    
    LaunchedEffect(Unit) {
        viewModel.syncFcmToken()
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = BgObsidian
    ) {
        Scaffold(
            containerColor = BgObsidian,
            topBar = {
                TopAppBar(
                    title = { Text(stringResource(R.string.settings_title).uppercase(), fontWeight = FontWeight.Bold, letterSpacing = 1.sp) },
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back), tint = Color.White)
                        }
                    },
                    actions = {
                        IconButton(onClick = {
                            viewModel.signOut()
                            onSignOut()
                        }) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Logout, 
                                contentDescription = "Sign Out", 
                                tint = Color.Red
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = BgObsidian,
                        titleContentColor = Accent
                    )
                )
            }
        ) { padding ->
            if (isLoading && settings == null) {
                ShimmerList(padding = padding)
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .padding(horizontal = 16.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    // Notifications Section
                    SettingsGroup(title = stringResource(R.string.notifications_group), icon = Icons.Outlined.Notifications) {
                        settings?.let { s ->
                            SettingToggle(
                                label = stringResource(R.string.sound_alerts),
                                checked = s.soundEnabled,
                                onCheckedChange = { viewModel.updateSettings(s.copy(soundEnabled = it)) }
                            )
                            SettingToggle(
                                label = stringResource(R.string.vibration),
                                checked = s.vibrationEnabled,
                                onCheckedChange = { viewModel.updateSettings(s.copy(vibrationEnabled = it)) }
                            )
                            SettingToggle(
                                label = stringResource(R.string.push_notifications),
                                checked = s.pushEnabled,
                                onCheckedChange = { viewModel.updateSettings(s.copy(pushEnabled = it)) }
                            )
                        }
                    }

                    // Security & Permissions (Troubleshooting)
                    SettingsGroup(title = stringResource(R.string.system_configuration), icon = Icons.Outlined.Security) {
                        Text(
                            text = stringResource(R.string.system_config_desc),
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                        TroubleItem(label = stringResource(R.string.overlay_perm), action = stringResource(R.string.configure)) { 
                            AndroidSettingsHelper.openOverlaySettings(context)
                        }
                        TroubleItem(label = stringResource(R.string.battery_perm), action = stringResource(R.string.unrestrict)) { 
                            AndroidSettingsHelper.openBatteryOptimizationSettings(context)
                        }
                        TroubleItem(label = stringResource(R.string.notif_perm), action = stringResource(R.string.view)) { 
                            AndroidSettingsHelper.openNotificationSettings(context)
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // ---- Personalization (Batch M) ----
                    com.hamburgbuzz.qrvault.ui.components.QrSectionLabel("Personalization")
                    com.hamburgbuzz.qrvault.ui.components.QrSettingRow(
                        icon = androidx.compose.material.icons.Icons.Filled.Person,
                        label = "Display name",
                        trailing = settings?.let {
                            // We don't store display_name in OwnerSettings, but
                            // we can show "Set" / "Edit" to hint state.
                            "Edit"
                        } ?: "Set",
                        onClick = { showDisplayNameDialog = true },
                    )
                    com.hamburgbuzz.qrvault.ui.components.QrSettingRow(
                        icon = androidx.compose.material.icons.Icons.Filled.EmojiPeople,
                        label = "Guest welcome message",
                        trailing = "Edit",
                        onClick = { showWelcomeDialog = true },
                    )
                    com.hamburgbuzz.qrvault.ui.components.QrSettingRow(
                        icon = androidx.compose.material.icons.Icons.AutoMirrored.Filled.ReplyAll,
                        label = "Quick replies",
                        trailing = (settings?.quickReplies?.size?.takeIf { it > 0 }?.toString()
                            ?: "default") + " / 5",
                        onClick = { showQuickRepliesDialog = true },
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    // ---- Diagnostics (Batch O #7) ----
                    com.hamburgbuzz.qrvault.ui.components.QrSectionLabel("Diagnostics")
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = BgElevated),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                androidx.compose.material.icons.Icons.Filled.BugReport,
                                contentDescription = null, tint = Accent,
                                modifier = Modifier.size(22.dp),
                            )
                            Spacer(modifier = Modifier.width(14.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text("Send crash reports", color = TextPrimary)
                                Text(
                                    "Anonymous stack traces. Off by default.",
                                    color = TextSecondary,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                            Switch(
                                checked = crashOptIn,
                                onCheckedChange = {
                                    crashOptIn = it
                                    com.hamburgbuzz.qrvault.util.CrashReporting.setOptIn(context, it)
                                },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = Accent,
                                    checkedTrackColor = Accent.copy(alpha = 0.4f),
                                ),
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // ---- App-lock (biometric / device PIN) ----
                    com.hamburgbuzz.qrvault.ui.components.QrSectionLabel("Security")
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = BgElevated),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                androidx.compose.material.icons.Icons.Filled.Fingerprint,
                                contentDescription = null, tint = Accent,
                                modifier = Modifier.size(22.dp),
                            )
                            Spacer(modifier = Modifier.width(14.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(stringResource(R.string.settings_app_lock), color = TextPrimary)
                                Text(
                                    if (biometricAvailable)
                                        stringResource(R.string.settings_app_lock_help)
                                    else
                                        stringResource(R.string.settings_app_lock_unavailable),
                                    color = TextSecondary,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                            Switch(
                                checked = appLockEnabled && biometricAvailable,
                                enabled = biometricAvailable,
                                onCheckedChange = { wantOn ->
                                    val activity = context as? androidx.fragment.app.FragmentActivity
                                    if (wantOn && activity != null) {
                                        // Verify once before enabling so a passer-by
                                        // can't turn the lock ON to deny the owner
                                        // (the OFF flow is gated below the same way).
                                        appLockScope.launch {
                                            val ok = com.hamburgbuzz.qrvault.util.BiometricGate.prompt(
                                                activity,
                                                context.getString(R.string.app_lock_title),
                                                context.getString(R.string.app_lock_subtitle),
                                            )
                                            if (ok) {
                                                appLockEnabled = true
                                                com.hamburgbuzz.qrvault.util.AppLockPrefs.setEnabled(context, true)
                                            }
                                        }
                                    } else if (!wantOn && activity != null) {
                                        appLockScope.launch {
                                            val ok = com.hamburgbuzz.qrvault.util.BiometricGate.prompt(
                                                activity,
                                                context.getString(R.string.app_lock_title),
                                                context.getString(R.string.app_lock_subtitle),
                                            )
                                            if (ok) {
                                                appLockEnabled = false
                                                com.hamburgbuzz.qrvault.util.AppLockPrefs.setEnabled(context, false)
                                            }
                                        }
                                    }
                                },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = Accent,
                                    checkedTrackColor = Accent.copy(alpha = 0.4f),
                                ),
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // ---- New (Batches B/C/G) account-scoped sections ----
                    com.hamburgbuzz.qrvault.ui.components.QrSectionLabel("Account")
                    com.hamburgbuzz.qrvault.ui.components.QrSettingRow(
                        icon = androidx.compose.material.icons.Icons.Filled.HealthAndSafety,
                        label = stringResource(R.string.health_title),
                        onClick = onNavigateToHealth,
                    )
                    com.hamburgbuzz.qrvault.ui.components.QrSettingRow(
                        icon = androidx.compose.material.icons.Icons.Filled.PhoneAndroid,
                        label = stringResource(R.string.devices_title),
                        onClick = onNavigateToDevices,
                    )
                    com.hamburgbuzz.qrvault.ui.components.QrSettingRow(
                        icon = androidx.compose.material.icons.Icons.Filled.MailOutline,
                        label = stringResource(R.string.invitations_pending_title),
                        onClick = onNavigateToInvitations,
                    )
                    com.hamburgbuzz.qrvault.ui.components.QrSettingRow(
                        icon = androidx.compose.material.icons.Icons.Filled.Send,
                        label = "Webhooks",
                        onClick = onNavigateToWebhooks,
                    )
                    com.hamburgbuzz.qrvault.ui.components.QrSettingRow(
                        icon = androidx.compose.material.icons.Icons.Filled.Info,
                        label = stringResource(R.string.about_title),
                        onClick = onNavigateToAbout,
                    )

                    Spacer(modifier = Modifier.height(32.dp))
                }
            }
        }
    }

    // ---- Personalization dialogs ----
    if (showDisplayNameDialog) {
        com.hamburgbuzz.qrvault.ui.components.TextFieldDialog(
            title = "Display name",
            helper = "Shown to guests as the owner of this house.",
            initial = "",
            placeholder = "e.g. Akhil",
            maxChars = 50,
            onDismiss = { showDisplayNameDialog = false },
            onSave = { viewModel.setDisplayName(it.ifBlank { null }) },
        )
    }

    if (showWelcomeDialog) {
        val activeHouseId = settings?.activeHouseId
        com.hamburgbuzz.qrvault.ui.components.TextFieldDialog(
            title = "Guest welcome message",
            helper = "Shown on the guest landing page when they scan your QR. Keep it short and friendly.",
            initial = "",
            placeholder = "Welcome — please leave packages by the gate",
            maxLines = 4,
            maxChars = 200,
            onDismiss = { showWelcomeDialog = false },
            onSave = { msg ->
                activeHouseId?.let { viewModel.setHouseWelcome(it, msg.ifBlank { null }) }
            },
        )
    }

    if (showQuickRepliesDialog) {
        com.hamburgbuzz.qrvault.ui.components.QuickRepliesEditor(
            initial = settings?.quickReplies,
            onDismiss = { showQuickRepliesDialog = false },
            onSave = { viewModel.setQuickReplies(it) },
        )
    }
}

@Composable
fun SettingsGroup(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, content: @Composable ColumnScope.() -> Unit) {
    Column {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 8.dp)) {
            Icon(icon, contentDescription = null, tint = Accent, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Text(title, style = MaterialTheme.typography.labelMedium, color = Accent, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
        }
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = BgElevated),
            shape = RoundedCornerShape(16.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF27272A))
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                content()
            }
        }
    }
}

@Composable
fun SettingToggle(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = Color.White)
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.Black,
                checkedTrackColor = Accent,
                uncheckedThumbColor = TextSecondary,
                uncheckedTrackColor = BgObsidian
            )
        )
    }
}

@Composable
fun TroubleItem(label: String, action: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onClick() }.padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, color = TextSecondary, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Text(action, color = Accent, fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 0.5.sp)
    }
}
