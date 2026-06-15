package com.hamburgbuzz.qrvault.ui.screens

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.FileUpload
import androidx.compose.material.icons.outlined.Gavel
import androidx.compose.material.icons.outlined.PrivacyTip
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.hamburgbuzz.qrvault.BuildConfig
import com.hamburgbuzz.qrvault.R
import com.hamburgbuzz.qrvault.ui.components.QrCard
import com.hamburgbuzz.qrvault.ui.components.QrScreen
import com.hamburgbuzz.qrvault.ui.components.QrSettingRow
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgElevated
import com.hamburgbuzz.qrvault.ui.theme.TextPrimary
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary
import com.hamburgbuzz.qrvault.ui.viewmodel.SettingsViewModel

@Composable
fun AboutScreen(
    onNavigateBack: () -> Unit,
    onAccountDeleted: () -> Unit,
    onNavigateToLicenses: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val ctx = LocalContext.current
    var showDeleteDialog by remember { mutableStateOf(false) }
    var deletingState by remember { mutableStateOf(false) }
    val error by viewModel.error.collectAsStateWithLifecycle()
    val base = BuildConfig.GUEST_BASE_URL.trimEnd('/')

    // Pending payload waiting for the user to pick a destination file.
    // Held in state because CreateDocument is a two-step dance: we issue
    // launch() but the URI comes back via the callback.
    var pendingExportJson by remember { mutableStateOf<String?>(null) }
    var showChangeEmailDialog by remember { mutableStateOf(false) }

    val createDocLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        contract = androidx.activity.result.contract.ActivityResultContracts.CreateDocument(
            "application/json",
        ),
    ) { uri: android.net.Uri? ->
        val payload = pendingExportJson
        pendingExportJson = null
        if (uri == null || payload == null) return@rememberLauncherForActivityResult
        val ok = runCatching {
            ctx.contentResolver.openOutputStream(uri)?.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                ?: error("Could not open destination file")
            true
        }.getOrElse { false }
        android.widget.Toast.makeText(
            ctx,
            if (ok) "Settings exported." else "Could not write export file.",
            android.widget.Toast.LENGTH_LONG,
        ).show()
    }

    val openDocLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        contract = androidx.activity.result.contract.ActivityResultContracts.OpenDocument(),
    ) { uri: android.net.Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val text = runCatching {
            ctx.contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
        }.getOrNull()
        if (text.isNullOrBlank()) {
            android.widget.Toast.makeText(ctx, "Could not read settings file.", android.widget.Toast.LENGTH_LONG).show()
            return@rememberLauncherForActivityResult
        }
        viewModel.importSettings(text) { ok ->
            android.widget.Toast.makeText(
                ctx,
                if (ok) "Settings imported." else "Import failed — see error below.",
                android.widget.Toast.LENGTH_LONG,
            ).show()
        }
    }

    QrScreen(
        title = stringResource(R.string.about_title),
        onNavigateBack = onNavigateBack,
    ) { pad ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(pad)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            QrCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    androidx.compose.foundation.Image(
                        painter = androidx.compose.ui.res.painterResource(id = R.drawable.app_icon),
                        contentDescription = null,
                        modifier = Modifier
                            .size(48.dp)
                            .background(Accent.copy(alpha = 0.12f), CircleShape)
                            .padding(8.dp),
                    )
                    Spacer(modifier = Modifier.width(14.dp))
                    Column {
                        Text("QR Vault", color = TextPrimary, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text(
                            stringResource(R.string.about_version, "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"),
                            color = TextSecondary,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }

            QrSettingRow(
                icon = Icons.Outlined.PrivacyTip,
                label = stringResource(R.string.about_privacy_policy),
                onClick = { openUrl(ctx, "$base/privacy.html") },
            )
            QrSettingRow(
                icon = Icons.Outlined.Gavel,
                label = stringResource(R.string.about_terms),
                onClick = { openUrl(ctx, "$base/terms.html") },
            )
            QrSettingRow(
                icon = Icons.Outlined.Description,
                label = stringResource(R.string.about_oss_licenses),
                onClick = onNavigateToLicenses,
            )
            QrSettingRow(
                icon = Icons.Outlined.Shield,
                label = stringResource(R.string.about_security),
                onClick = { openUrl(ctx, "$base/security.html") },
            )

            Spacer(modifier = Modifier.height(4.dp))

            QrSettingRow(
                icon = Icons.Outlined.AlternateEmail,
                label = stringResource(R.string.about_change_email),
                trailing = viewModel.currentEmail() ?: "—",
                onClick = { showChangeEmailDialog = true },
            )

            QrSettingRow(
                icon = Icons.Outlined.FileDownload,
                label = stringResource(R.string.about_export_settings),
                onClick = {
                    viewModel.exportSettings { json ->
                        if (json.isNullOrBlank()) {
                            android.widget.Toast.makeText(
                                ctx,
                                "Nothing to export.",
                                android.widget.Toast.LENGTH_LONG,
                            ).show()
                            return@exportSettings
                        }
                        pendingExportJson = json
                        val suggested = "qrvault-settings-" +
                            java.text.SimpleDateFormat("yyyyMMdd", java.util.Locale.US)
                                .format(java.util.Date()) + ".json"
                        runCatching { createDocLauncher.launch(suggested) }
                            .onFailure {
                                pendingExportJson = null
                                android.widget.Toast.makeText(
                                    ctx,
                                    "No file picker available on this device.",
                                    android.widget.Toast.LENGTH_LONG,
                                ).show()
                            }
                    }
                },
            )
            QrSettingRow(
                icon = Icons.Outlined.FileUpload,
                label = stringResource(R.string.about_import_settings),
                onClick = {
                    runCatching {
                        // application/json is the canonical MIME, but some
                        // pickers won't show it. */* with extra-mime falls
                        // back gracefully.
                        openDocLauncher.launch(arrayOf("application/json", "text/plain", "*/*"))
                    }.onFailure {
                        android.widget.Toast.makeText(
                            ctx,
                            "No file picker available on this device.",
                            android.widget.Toast.LENGTH_LONG,
                        ).show()
                    }
                },
            )

            Spacer(modifier = Modifier.height(16.dp))

            OutlinedButton(
                onClick = { showDeleteDialog = true },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFFCA5A5)),
                shape = RoundedCornerShape(12.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF7F1D1D)),
            ) {
                Icon(Icons.Outlined.DeleteForever, contentDescription = null, tint = Color(0xFFFCA5A5))
                Spacer(modifier = Modifier.width(8.dp))
                Text(stringResource(R.string.about_delete_account), fontWeight = FontWeight.SemiBold)
            }

            error?.let {
                Text(it, color = Color(0xFFFCA5A5), style = MaterialTheme.typography.bodySmall)
            }
        }
    }

    if (showChangeEmailDialog) {
        com.hamburgbuzz.qrvault.ui.components.TextFieldDialog(
            title = stringResource(R.string.about_change_email),
            helper = stringResource(R.string.about_change_email_help),
            initial = viewModel.currentEmail().orEmpty(),
            placeholder = "new@example.com",
            allowEmpty = false,
            onDismiss = { showChangeEmailDialog = false },
            onSave = { newEmail ->
                viewModel.changeEmail(newEmail) { ok ->
                    android.widget.Toast.makeText(
                        ctx,
                        if (ok) "Confirmation link sent to $newEmail. Tap it to complete the change."
                        else    "Could not update email.",
                        android.widget.Toast.LENGTH_LONG,
                    ).show()
                }
            },
        )
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { if (!deletingState) showDeleteDialog = false },
            containerColor = BgElevated,
            title = { Text(stringResource(R.string.about_delete_account), color = TextPrimary, fontWeight = FontWeight.Bold) },
            text = { Text(stringResource(R.string.about_delete_account_confirm), color = TextSecondary) },
            confirmButton = {
                Button(
                    onClick = {
                        deletingState = true
                        viewModel.deleteAccount { ok ->
                            deletingState = false
                            showDeleteDialog = false
                            if (ok) onAccountDeleted()
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB91C1C)),
                    enabled = !deletingState,
                ) {
                    if (deletingState) {
                        CircularProgressIndicator(strokeWidth = 2.dp, color = Color.White, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                    Text("DELETE", color = Color.White, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }, enabled = !deletingState) {
                    Text("CANCEL", color = TextSecondary)
                }
            },
        )
    }
}

private fun openUrl(ctx: android.content.Context, url: String) {
    runCatching {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)))
    }
}
