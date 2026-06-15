package com.hamburgbuzz.qrvault.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.ui.res.stringResource
import com.hamburgbuzz.qrvault.R
import com.hamburgbuzz.qrvault.data.model.AuditEntry
import com.hamburgbuzz.qrvault.ui.theme.*
import com.hamburgbuzz.qrvault.ui.viewmodel.AuditViewModel
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuditScreen(
    onNavigateBack: () -> Unit,
    onSignOut: () -> Unit,
    viewModel: AuditViewModel = hiltViewModel()
) {
    val auditEntries by viewModel.auditEntries.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()

    val context = LocalContext.current
    LaunchedEffect(error) {
        error?.let {
            Toast.makeText(context, it, Toast.LENGTH_LONG).show()
            viewModel.clearError()
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = BgObsidian
    ) {
        Scaffold(
            containerColor = BgObsidian,
            topBar = {
                TopAppBar(
                    title = { Text(stringResource(R.string.audit_title).uppercase(), fontWeight = FontWeight.Bold, letterSpacing = 1.sp) },
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back), tint = Color.White)
                        }
                    },
                    actions = {
                        if (auditEntries.isNotEmpty()) {
                            IconButton(onClick = { viewModel.clearAuditLog() }) {
                                Icon(Icons.Default.ClearAll, contentDescription = stringResource(R.string.clear_all), tint = Color.Red.copy(alpha = 0.7f))
                            }
                        }
                        IconButton(onClick = {
                            viewModel.signOut()
                            onSignOut()
                        }) {
                            Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Sign Out", tint = Color.Red)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = BgObsidian,
                        titleContentColor = Accent
                    )
                )
            }
        ) { padding ->
            if (isLoading && auditEntries.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Accent)
                }
            } else if (auditEntries.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    Text(stringResource(R.string.no_audit), color = TextSecondary)
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 24.dp)
                ) {
                    items(auditEntries) { entry ->
                        AuditItem(entry)
                    }
                }
            }
        }
    }
}

@Composable
fun AuditItem(entry: AuditEntry) {
    var showDetails by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { showDetails = !showDetails },
        colors = CardDefaults.cardColors(containerColor = BgElevated),
        shape = RoundedCornerShape(12.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, if (showDetails) Accent.copy(alpha = 0.5f) else Color.Transparent)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .background(
                            when {
                                entry.action.contains("DELETE", true) -> Color.Red.copy(alpha = 0.1f)
                                entry.action.contains("UPDATE", true) -> Color.Blue.copy(alpha = 0.1f)
                                else -> Accent.copy(alpha = 0.1f)
                            },
                            RoundedCornerShape(10.dp)
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = when {
                            entry.action.contains("DELETE", true) -> Icons.Outlined.Delete
                            entry.action.contains("UPDATE", true) -> Icons.Outlined.Edit
                            else -> Icons.Outlined.Info
                        },
                        contentDescription = null,
                        tint = when {
                            entry.action.contains("DELETE", true) -> Color.Red.copy(alpha = 0.7f)
                            entry.action.contains("UPDATE", true) -> Color.Blue.copy(alpha = 0.7f)
                            else -> Accent
                        },
                        modifier = Modifier.size(20.dp)
                    )
                }
                Spacer(modifier = Modifier.width(16.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = entry.action,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        fontSize = 14.sp
                    )
                    Text(
                        text = formatAuditTime(entry.createdAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = TextSecondary,
                        modifier = Modifier.padding(top = 2.dp)
                    )
                }
                if (!entry.details.isNullOrBlank()) {
                    Icon(
                        imageVector = if (showDetails) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                        contentDescription = null,
                        tint = TextSecondary
                    )
                }
            }

            if (showDetails && !entry.details.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(12.dp))
                HorizontalDivider(color = Color.White.copy(alpha = 0.05f))
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = entry.details,
                    style = MaterialTheme.typography.bodySmall,
                    color = TextPrimary,
                    lineHeight = 18.sp
                )
                if (!entry.entity.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Target: ${entry.entity}",
                        style = MaterialTheme.typography.labelSmall,
                        color = Accent.copy(alpha = 0.6f)
                    )
                }
            }
        }
    }
}

private fun formatAuditTime(timestamp: String): String {
    return try {
        val dt = ZonedDateTime.parse(timestamp)
        dt.format(DateTimeFormatter.ofPattern("MMM d, HH:mm"))
    } catch (e: Exception) {
        timestamp
    }
}
