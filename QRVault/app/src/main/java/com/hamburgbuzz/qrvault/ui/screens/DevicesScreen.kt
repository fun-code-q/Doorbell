package com.hamburgbuzz.qrvault.ui.screens

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.PowerSettingsNew
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.hamburgbuzz.qrvault.R
import com.hamburgbuzz.qrvault.data.repository.DeviceRepository
import com.hamburgbuzz.qrvault.ui.components.QrEmptyState
import com.hamburgbuzz.qrvault.ui.components.QrScreen
import com.hamburgbuzz.qrvault.ui.components.QrSkeletonRow
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgElevated
import com.hamburgbuzz.qrvault.ui.theme.TextPrimary
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary
import com.hamburgbuzz.qrvault.ui.viewmodel.DevicesViewModel

@Composable
fun DevicesScreen(
    onNavigateBack: () -> Unit,
    viewModel: DevicesViewModel = hiltViewModel(),
) {
    val devices by viewModel.devices.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val thisTokenSuffix by viewModel.thisDeviceFcmTokenSuffix.collectAsStateWithLifecycle()
    var pendingRevoke by remember { mutableStateOf<DeviceRepository.Device?>(null) }

    QrScreen(
        title = stringResource(R.string.devices_title),
        onNavigateBack = onNavigateBack,
        actions = {
            TextButton(onClick = { viewModel.refresh() }) {
                Text("Refresh", color = Accent, fontWeight = FontWeight.SemiBold)
            }
        },
    ) { pad ->
        Box(modifier = Modifier.fillMaxSize().padding(pad)) {
            AnimatedVisibility(
                visible = isLoading && devices.isEmpty(),
                enter = fadeIn(tween(150)),
                exit = fadeOut(tween(150)),
            ) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    repeat(4) { QrSkeletonRow() }
                }
            }

            AnimatedVisibility(
                visible = !isLoading && devices.isEmpty(),
                enter = fadeIn(tween(200)),
                exit = fadeOut(tween(150)),
            ) {
                QrEmptyState(
                    icon = Icons.Outlined.PhoneAndroid,
                    title = "No devices yet",
                    body = stringResource(R.string.devices_empty),
                )
            }

            AnimatedVisibility(
                visible = devices.isNotEmpty(),
                enter = fadeIn(tween(200)),
                exit = fadeOut(tween(150)),
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(devices, key = { it.id }) { d ->
                        DeviceRow(
                            d = d,
                            isCurrent = thisTokenSuffix != null
                                    && d.deviceLabel?.endsWith(thisTokenSuffix!!) == true,
                            onRevoke = { pendingRevoke = d },
                        )
                    }
                }
            }
        }
    }

    pendingRevoke?.let { d ->
        AlertDialog(
            onDismissRequest = { pendingRevoke = null },
            containerColor = BgElevated,
            title = { Text("Revoke device?", color = TextPrimary, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "${d.deviceLabel ?: d.platform} will stop receiving rings until you sign in there again.",
                    color = TextSecondary,
                )
            },
            confirmButton = {
                Button(
                    onClick = { viewModel.revoke(d.id); pendingRevoke = null },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB91C1C)),
                ) { Text(stringResource(R.string.device_revoke), color = Color.White, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { pendingRevoke = null }) {
                    Text("CANCEL", color = TextSecondary)
                }
            },
        )
    }
}

@Composable
private fun DeviceRow(
    d: DeviceRepository.Device,
    isCurrent: Boolean,
    onRevoke: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = BgElevated),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .background(Accent.copy(alpha = 0.12f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.PhoneAndroid, contentDescription = null, tint = Accent, modifier = Modifier.size(22.dp))
            }
            Spacer(modifier = Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        d.deviceLabel ?: d.platform.replaceFirstChar { it.uppercase() },
                        color = TextPrimary,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (isCurrent) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            stringResource(R.string.device_this_device),
                            color = Accent,
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier
                                .background(Accent.copy(alpha = 0.15f), RoundedCornerShape(6.dp))
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
                Text(
                    "Last seen ${d.lastSeenAt.take(19).replace('T', ' ')}",
                    color = TextSecondary,
                    style = MaterialTheme.typography.bodySmall,
                )
                if (!d.isActive) {
                    Text(
                        "Inactive",
                        color = Color(0xFFFCA5A5),
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
            if (d.isActive && !isCurrent) {
                TextButton(onClick = onRevoke) {
                    Icon(Icons.Outlined.PowerSettingsNew, contentDescription = null, tint = Color(0xFFFCA5A5))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(stringResource(R.string.device_revoke), color = Color(0xFFFCA5A5), fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
