package com.hamburgbuzz.qrvault.ui.screens

import android.content.Intent
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.hamburgbuzz.qrvault.R
import com.hamburgbuzz.qrvault.ui.components.QrCard
import com.hamburgbuzz.qrvault.ui.components.QrScreen
import com.hamburgbuzz.qrvault.ui.components.QrSkeletonRow
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgElevated
import com.hamburgbuzz.qrvault.ui.theme.TextPrimary
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary
import com.hamburgbuzz.qrvault.ui.viewmodel.HealthViewModel
import com.hamburgbuzz.qrvault.util.HealthCheck
import com.hamburgbuzz.qrvault.util.HealthStatus

private val Green = Color(0xFF22C55E)
private val Amber = Color(0xFFFACC15)
private val Red   = Color(0xFFEF4444)

@Composable
fun HealthScreen(
    onNavigateBack: () -> Unit,
    viewModel: HealthViewModel = hiltViewModel(),
) {
    val checks by viewModel.checks.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val ctx = LocalContext.current

    val summary by remember(checks) {
        derivedStateOf {
            val blocking = checks.count { it.status == HealthStatus.BLOCKING }
            val warnings = checks.count { it.status == HealthStatus.WARNING }
            Triple(blocking, warnings, checks.size - blocking - warnings)
        }
    }

    QrScreen(
        title = stringResource(R.string.health_title),
        onNavigateBack = onNavigateBack,
        actions = {
            TextButton(onClick = { viewModel.refresh() }) {
                Text(stringResource(R.string.health_refresh), color = Accent, fontWeight = FontWeight.SemiBold)
            }
        },
    ) { pad ->
        Box(modifier = Modifier.fillMaxSize().padding(pad)) {
            AnimatedVisibility(
                visible = isLoading && checks.isEmpty(),
                enter = fadeIn(tween(150)),
                exit = fadeOut(tween(150)),
            ) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    repeat(5) { QrSkeletonRow() }
                }
            }

            AnimatedVisibility(
                visible = !isLoading || checks.isNotEmpty(),
                enter = fadeIn(tween(200)),
                exit = fadeOut(tween(150)),
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    item {
                        HealthSummaryCard(
                            blocking = summary.first,
                            warnings = summary.second,
                            ok = summary.third,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                    }
                    items(checks, key = { it.id }) { c ->
                        HealthRow(c) { actionIntent ->
                            // OEM autostart routes through our helper to
                            // hit the vendor's specific autostart screen.
                            if (actionIntent.action == com.hamburgbuzz.qrvault.util.RingHealthCheck.ACTION_OEM_AUTOSTART) {
                                com.hamburgbuzz.qrvault.util.OemAutostart.openAutostartIfApplicable(ctx)
                            } else {
                                runCatching { ctx.startActivity(actionIntent) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HealthSummaryCard(blocking: Int, warnings: Int, ok: Int) {
    val (overallColor, overallText) = when {
        blocking > 0 -> Red to "Action required"
        warnings > 0 -> Amber to "Mostly good"
        else         -> Green to "All systems go"
    }
    QrCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .background(overallColor.copy(alpha = 0.15f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.HealthAndSafety,
                    contentDescription = null,
                    tint = overallColor,
                    modifier = Modifier.size(28.dp),
                )
            }
            Spacer(modifier = Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(overallText, color = TextPrimary, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "$ok ok · $warnings warn · $blocking block",
                    color = TextSecondary,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun HealthRow(c: HealthCheck, onFix: (Intent) -> Unit) {
    val (icon, color, semantic) = when (c.status) {
        HealthStatus.OK       -> Triple(Icons.Filled.CheckCircle, Green, "OK")
        HealthStatus.WARNING  -> Triple(Icons.Filled.Warning,     Amber, "Warning")
        HealthStatus.BLOCKING -> Triple(Icons.Filled.Error,       Red,   "Blocking")
    }
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = "${c.title}, $semantic. ${c.description}" },
        colors = CardDefaults.cardColors(containerColor = BgElevated),
        shape = RoundedCornerShape(14.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .background(color.copy(alpha = 0.12f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(22.dp))
            }
            Spacer(modifier = Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(c.title, color = TextPrimary, fontWeight = FontWeight.SemiBold)
                Text(
                    c.description,
                    color = TextSecondary,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 3,
                )
            }
            if (c.fixIntentAction != null && c.status != HealthStatus.OK) {
                IconButton(
                    onClick = {
                        onFix(Intent(c.fixIntentAction).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
                    },
                ) { Text(stringResource(R.string.health_fix), color = Accent, fontWeight = FontWeight.Bold) }
            }
        }
    }
}
