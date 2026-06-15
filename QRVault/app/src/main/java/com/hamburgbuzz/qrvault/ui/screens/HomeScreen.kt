package com.hamburgbuzz.qrvault.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material.icons.outlined.*
import androidx.compose.material.icons.rounded.History
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.hamburgbuzz.qrvault.R
import com.hamburgbuzz.qrvault.ui.components.RingCard
import com.hamburgbuzz.qrvault.ui.components.StatCard
import com.hamburgbuzz.qrvault.ui.theme.*
import com.hamburgbuzz.qrvault.ui.viewmodel.HomeViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onNavigateToSettings: () -> Unit,
    onSignOut: () -> Unit,
    onNavigateToInvitations: () -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel(),
    invitationsViewModel: com.hamburgbuzz.qrvault.ui.viewmodel.InvitationsViewModel = hiltViewModel(),
) {
    val pendingInvitations by invitationsViewModel.pending.collectAsStateWithLifecycle()
    val rings by viewModel.filteredRings.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val stats by viewModel.stats.collectAsStateWithLifecycle()
    val searchQuery by viewModel.searchQuery.collectAsStateWithLifecycle()
    val filterStatus by viewModel.filterStatus.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()

    val context = LocalContext.current
    LaunchedEffect(error) {
        error?.let {
            Toast.makeText(context, it, Toast.LENGTH_LONG).show()
            viewModel.clearError()
        }
    }

    var showReplyDialogForId by remember { mutableStateOf<String?>(null) }
    // The incoming-ring UI is owned by IncomingRingActivity now (started by
    // QrFcmService via a foreground service). No in-screen overlay needed.

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = BgObsidian
    ) {
        Scaffold(
            containerColor = BgObsidian,
            topBar = {
                TopAppBar(
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = stringResource(R.string.home_title).uppercase(),
                                style = MaterialTheme.typography.headlineSmall,
                                color = Accent,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 2.sp
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            // Hidden when the user has only one house (Batch N #9).
                            com.hamburgbuzz.qrvault.ui.components.HouseSwitcher(
                                onHouseChanged = { viewModel.loadRings() },
                            )
                        }
                    },
                    actions = {
                        // Pending-invitations badge (Batch B #3). Pulses
                        // amber when there's one or more pending so the
                        // owner notices without opening Settings.
                        if (pendingInvitations.isNotEmpty()) {
                            androidx.compose.material3.BadgedBox(
                                badge = {
                                    androidx.compose.material3.Badge(
                                        containerColor = Accent,
                                        contentColor = BgObsidian,
                                    ) {
                                        Text(
                                            text = pendingInvitations.size.toString(),
                                            style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
                                            fontWeight = FontWeight.Bold,
                                        )
                                    }
                                },
                                modifier = Modifier.padding(end = 8.dp),
                            ) {
                                IconButton(onClick = onNavigateToInvitations) {
                                    Icon(
                                        imageVector = androidx.compose.material.icons.Icons.Outlined.MailOutline,
                                        contentDescription = "Pending invitations",
                                        tint = Accent,
                                    )
                                }
                            }
                        }
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
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                contentPadding = PaddingValues(bottom = 24.dp)
            ) {
                item {
                    // Unverified-email nudge. Self-hides once the user's
                    // session reflects email_confirmed_at != null.
                    com.hamburgbuzz.qrvault.ui.components.EmailVerificationBanner()
                }

                item {
                    // Stats Grid
                    if (isLoading && stats.totalDoors == 0) {
                        Column {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                com.hamburgbuzz.qrvault.ui.components.ShimmerPlaceholder(modifier = Modifier.weight(1f).height(100.dp), shape = RoundedCornerShape(16.dp))
                                com.hamburgbuzz.qrvault.ui.components.ShimmerPlaceholder(modifier = Modifier.weight(1f).height(100.dp), shape = RoundedCornerShape(16.dp))
                            }
                            Spacer(modifier = Modifier.height(12.dp))
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                com.hamburgbuzz.qrvault.ui.components.ShimmerPlaceholder(modifier = Modifier.weight(1f).height(100.dp), shape = RoundedCornerShape(16.dp))
                                com.hamburgbuzz.qrvault.ui.components.ShimmerPlaceholder(modifier = Modifier.weight(1f).height(100.dp), shape = RoundedCornerShape(16.dp))
                            }
                        }
                    } else {
                        Column {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                StatCard(
                                    value = stats.missed.toString(),
                                    label = stringResource(R.string.stat_missed),
                                    icon = Icons.Outlined.PhoneMissed,
                                    modifier = Modifier.weight(1f)
                                )
                                StatCard(
                                    value = stats.answered.toString(),
                                    label = stringResource(R.string.stat_answered),
                                    icon = Icons.Outlined.CheckCircle,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                            Spacer(modifier = Modifier.height(12.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                StatCard(
                                    value = stats.totalDoors.toString(),
                                    label = stringResource(R.string.stat_total_doors),
                                    icon = Icons.Outlined.DoorSliding,
                                    modifier = Modifier.weight(1f)
                                )
                                StatCard(
                                    value = stats.paused.toString(),
                                    label = stringResource(R.string.stat_paused),
                                    icon = Icons.Outlined.PauseCircle,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                    }
                }

                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = stringResource(R.string.activity_log),
                            style = MaterialTheme.typography.labelMedium,
                            color = Accent,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp
                        )
                        Text(
                            text = stringResource(R.string.mark_all_read),
                            style = MaterialTheme.typography.labelSmall,
                            color = Accent,
                            modifier = Modifier.clickable { /* Mark all read logic */ }
                        )
                    }
                }

                item {
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = { viewModel.setSearchQuery(it) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 8.dp),
                        placeholder = { Text(stringResource(R.string.search_placeholder), color = TextSecondary) },
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = Accent) },
                        shape = RoundedCornerShape(16.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedContainerColor = BgElevated,
                            unfocusedContainerColor = BgElevated,
                            focusedBorderColor = Accent,
                            unfocusedBorderColor = Color(0xFF27272A),
                            cursorColor = Accent,
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White
                        ),
                        singleLine = true
                    )
                }

                item {
                    // Filter Pills
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        val filterMap = listOf(
                            "all" to R.string.filter_all,
                            "waiting" to R.string.filter_waiting,
                            "responded" to R.string.filter_responded
                        )
                        items(filterMap) { pair ->
                            val (filter, labelRes) = pair
                            FilterPill(
                                label = stringResource(labelRes),
                                active = filterStatus == filter,
                                onClick = { viewModel.setFilterStatus(filter) }
                            )
                        }
                    }
                }

                if (isLoading && rings.isEmpty()) {
                    items(3) {
                        com.hamburgbuzz.qrvault.ui.components.ShimmerPlaceholder(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(120.dp)
                                .padding(vertical = 4.dp),
                            shape = RoundedCornerShape(16.dp)
                        )
                    }
                } else if (rings.isEmpty()) {
                    item {
                        Box(modifier = Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) {
                            Text(
                                text = stringResource(R.string.no_matching_visitors),
                                style = MaterialTheme.typography.bodyMedium,
                                color = TextSecondary
                            )
                        }
                    }
                } else {
                    items(rings) { ring ->
                        RingCard(
                            ring = ring,
                            onAck = { viewModel.sendReply(it, "Acknowledged") },
                            onComing = { viewModel.sendReply(it, "Coming") },
                            onCustomReply = { showReplyDialogForId = it },
                            onDelete = { viewModel.deleteRing(it) }
                        )
                    }
                }
            }

            showReplyDialogForId?.let { ringId ->
                com.hamburgbuzz.qrvault.ui.components.ReplyDialog(
                    onDismiss = { showReplyDialogForId = null },
                    onConfirm = { message ->
                        viewModel.sendReply(ringId, message)
                        showReplyDialogForId = null
                    }
                )
            }
        }
    }

    // Incoming-ring UI now lives in IncomingRingActivity (full-screen
    // CallStyle), shown by RingForegroundService from FCM.
}

@Composable
fun FilterPill(
    label: String,
    active: Boolean,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier.clickable { onClick() },
        shape = RoundedCornerShape(50),
        color = if (active) Accent else Color.Transparent,
        border = if (active) null else androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF27272A))
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            style = MaterialTheme.typography.labelMedium,
            color = if (active) Color.Black else TextSecondary,
            fontWeight = FontWeight.SemiBold
        )
    }
}
