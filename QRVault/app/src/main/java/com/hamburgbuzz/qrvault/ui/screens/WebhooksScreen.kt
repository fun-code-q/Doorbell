package com.hamburgbuzz.qrvault.ui.screens

import android.security.keystore.KeyGenParameterSpec
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Webhook
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.widget.Toast
import com.hamburgbuzz.qrvault.data.repository.WebhookRepository
import com.hamburgbuzz.qrvault.ui.components.QrEmptyState
import com.hamburgbuzz.qrvault.ui.components.QrScreen
import com.hamburgbuzz.qrvault.ui.components.QrSkeletonRow
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgElevated
import com.hamburgbuzz.qrvault.ui.theme.BgObsidian
import com.hamburgbuzz.qrvault.ui.theme.TextPrimary
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary
import com.hamburgbuzz.qrvault.ui.viewmodel.WebhooksViewModel
import java.security.SecureRandom

@Composable
fun WebhooksScreen(
    onNavigateBack: () -> Unit,
    viewModel: WebhooksViewModel = hiltViewModel(),
) {
    val hooks by viewModel.hooks.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()
    val ctx = LocalContext.current

    var showAddDialog by rememberSaveable { mutableStateOf(false) }
    var pendingDelete by remember { mutableStateOf<WebhookRepository.Webhook?>(null) }

    error?.let {
        androidx.compose.runtime.LaunchedEffect(it) {
            Toast.makeText(ctx, it, Toast.LENGTH_LONG).show()
            viewModel.clearError()
        }
    }

    Scaffold(
        modifier = Modifier.fillMaxSize().background(BgObsidian),
        containerColor = BgObsidian,
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { showAddDialog = true },
                containerColor = Accent,
                contentColor = BgObsidian,
                shape = RoundedCornerShape(16.dp),
            ) {
                Icon(Icons.Outlined.Add, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Add webhook", fontWeight = FontWeight.Bold)
            }
        },
    ) { _ ->
        QrScreen(title = "Webhooks", onNavigateBack = onNavigateBack) { pad ->
            Box(modifier = Modifier.fillMaxSize().padding(pad)) {
                AnimatedVisibility(
                    visible = isLoading && hooks.isEmpty(),
                    enter = fadeIn(tween(150)),
                    exit = fadeOut(tween(150)),
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) { repeat(3) { QrSkeletonRow() } }
                }

                AnimatedVisibility(
                    visible = !isLoading && hooks.isEmpty(),
                    enter = fadeIn(tween(200)),
                    exit = fadeOut(tween(150)),
                ) {
                    QrEmptyState(
                        icon = Icons.Outlined.Webhook,
                        title = "No webhooks yet",
                        body = "Wire IFTTT, Zapier, Home Assistant or your own endpoint to fire on every ring.",
                    )
                }

                AnimatedVisibility(
                    visible = hooks.isNotEmpty(),
                    enter = fadeIn(tween(200)),
                    exit = fadeOut(tween(150)),
                ) {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 96.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(hooks, key = { it.id ?: it.url }) { hook ->
                            WebhookRow(
                                hook = hook,
                                onToggle = { viewModel.setActive(hook.id ?: return@WebhookRow, it) },
                                onDelete = { pendingDelete = hook },
                            )
                        }
                    }
                }
            }
        }
    }

    if (showAddDialog) {
        AddWebhookDialog(
            onDismiss = { showAddDialog = false },
            onSave = { url, secret, desc ->
                viewModel.add(url, secret, desc)
                showAddDialog = false
            },
        )
    }

    pendingDelete?.let { d ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            containerColor = BgElevated,
            title = { Text("Delete webhook?", color = TextPrimary, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "Rings will stop firing to ${d.url} immediately.",
                    color = TextSecondary,
                )
            },
            confirmButton = {
                Button(
                    onClick = { viewModel.remove(d.id ?: return@Button); pendingDelete = null },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB91C1C)),
                ) { Text("DELETE", color = Color.White, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text("CANCEL", color = TextSecondary) }
            },
        )
    }
}

@Composable
private fun WebhookRow(
    hook: WebhookRepository.Webhook,
    onToggle: (Boolean) -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = BgElevated),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .background(Accent.copy(alpha = 0.12f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Bolt, contentDescription = null, tint = Accent, modifier = Modifier.size(20.dp))
            }
            Spacer(modifier = Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    hook.description?.takeIf { it.isNotBlank() } ?: hook.url,
                    color = TextPrimary, fontWeight = FontWeight.SemiBold, maxLines = 1,
                )
                Text(
                    hook.url,
                    color = TextSecondary,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                )
                Text(
                    "Fires on: ${hook.onEvents}",
                    color = TextSecondary,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            Switch(
                checked = hook.isActive,
                onCheckedChange = onToggle,
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Accent,
                    checkedTrackColor = Accent.copy(alpha = 0.4f),
                ),
            )
            TextButton(onClick = onDelete) {
                Icon(Icons.Outlined.Delete, contentDescription = "Delete", tint = Color(0xFFFCA5A5))
            }
        }
    }
}

@Composable
private fun AddWebhookDialog(
    onDismiss: () -> Unit,
    onSave: (url: String, secret: String, description: String?) -> Unit,
) {
    var url by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var secret by rememberSaveable {
        mutableStateOf(
            // 32-byte random hex for a strong default secret.
            ByteArray(24).also { SecureRandom().nextBytes(it) }
                .joinToString("") { "%02x".format(it) }
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgElevated,
        shape = RoundedCornerShape(20.dp),
        title = { Text("New webhook", color = TextPrimary, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "We HMAC-SHA256 every ring payload. Save the secret on the receiving end to verify it came from us.",
                    color = TextSecondary,
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it.trim() },
                    label = { Text("URL (https://…)", color = TextSecondary) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = Color(0xFF27272A),
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        cursorColor = Accent,
                    ),
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Description (optional)", color = TextSecondary) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = Color(0xFF27272A),
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        cursorColor = Accent,
                    ),
                )
                OutlinedTextField(
                    value = secret,
                    onValueChange = { secret = it },
                    label = { Text("HMAC secret (auto-generated, edit if needed)", color = TextSecondary) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = Color(0xFF27272A),
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        cursorColor = Accent,
                    ),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(url, secret, description) },
                enabled = url.startsWith("https://") && secret.length >= 16,
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
                shape = RoundedCornerShape(10.dp),
            ) { Text("ADD", color = BgObsidian, fontWeight = FontWeight.Bold) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("CANCEL", color = TextSecondary) }
        },
    )
}
