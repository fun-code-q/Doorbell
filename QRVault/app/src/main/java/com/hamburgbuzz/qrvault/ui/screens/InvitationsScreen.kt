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
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.hamburgbuzz.qrvault.R
import com.hamburgbuzz.qrvault.data.repository.InvitationRepository
import com.hamburgbuzz.qrvault.ui.components.QrEmptyState
import com.hamburgbuzz.qrvault.ui.components.QrScreen
import com.hamburgbuzz.qrvault.ui.components.QrSkeletonRow
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgElevated
import com.hamburgbuzz.qrvault.ui.theme.BgObsidian
import com.hamburgbuzz.qrvault.ui.theme.TextPrimary
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary
import com.hamburgbuzz.qrvault.ui.viewmodel.InvitationsViewModel

@Composable
fun InvitationsScreen(
    onNavigateBack: () -> Unit,
    viewModel: InvitationsViewModel = hiltViewModel(),
) {
    val pending by viewModel.pending.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()

    QrScreen(
        title = stringResource(R.string.invitations_pending_title),
        onNavigateBack = onNavigateBack,
    ) { pad ->
        Box(modifier = Modifier.fillMaxSize().padding(pad)) {
            AnimatedVisibility(
                visible = isLoading && pending.isEmpty(),
                enter = fadeIn(tween(150)),
                exit = fadeOut(tween(150)),
            ) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) { repeat(3) { QrSkeletonRow() } }
            }

            AnimatedVisibility(
                visible = !isLoading && pending.isEmpty(),
                enter = fadeIn(tween(200)),
                exit = fadeOut(tween(150)),
            ) {
                QrEmptyState(
                    icon = Icons.Outlined.MailOutline,
                    title = "No pending invitations",
                    body = "When someone shares a house with you, it appears here.",
                )
            }

            AnimatedVisibility(
                visible = pending.isNotEmpty(),
                enter = fadeIn(tween(200)),
                exit = fadeOut(tween(150)),
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(pending, key = { it.id }) { inv ->
                        InvitationRow(
                            inv = inv,
                            onAccept = { viewModel.accept(inv.id) },
                            onDecline = { viewModel.decline(inv.id) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun InvitationRow(
    inv: InvitationRepository.PendingInvitation,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = BgElevated),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.size(40.dp).background(Accent.copy(alpha = 0.12f), CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.MailOutline, contentDescription = null, tint = Accent) }
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(inv.houseName, color = TextPrimary, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "${inv.invitedByUsername ?: "Someone"} invited you as ${inv.role}",
                        color = TextSecondary,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    onClick = onDecline,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary),
                    shape = RoundedCornerShape(12.dp),
                ) { Text(stringResource(R.string.invitation_decline), fontWeight = FontWeight.SemiBold) }
                Button(
                    onClick = onAccept,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Accent),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(
                        stringResource(R.string.invitation_accept),
                        color = BgObsidian,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}
