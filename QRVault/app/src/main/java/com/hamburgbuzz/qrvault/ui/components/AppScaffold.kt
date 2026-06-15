package com.hamburgbuzz.qrvault.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgElevated
import com.hamburgbuzz.qrvault.ui.theme.BgObsidian
import com.hamburgbuzz.qrvault.ui.theme.TextPrimary
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary

/**
 * QRVault's standard screen frame. Every secondary screen renders inside
 * one of these so spacing, typography, top-bar layout, and back-arrow
 * placement are identical across About / Devices / Health / Invitations.
 *
 * Using a shared frame is the cheapest possible way to make the app feel
 * "designed" rather than "stitched together from screens".
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QrScreen(
    title: String,
    onNavigateBack: () -> Unit,
    actions: @Composable () -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    Scaffold(
        modifier = Modifier.fillMaxSize().background(BgObsidian),
        containerColor = BgObsidian,
        contentWindowInsets = WindowInsets.statusBars,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        title.uppercase(),
                        style = MaterialTheme.typography.titleMedium,
                        color = Accent,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 2.sp,
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = onNavigateBack,
                        modifier = Modifier.semantics {
                            role = Role.Button
                            contentDescription = "Back"
                        },
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = null,
                            tint = TextPrimary,
                        )
                    }
                },
                actions = { actions() },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgObsidian,
                    titleContentColor = Accent,
                ),
            )
        },
        content = content,
    )
}

// ---------------------------------------------------------------------------
// Reusable building blocks. Each is a single, small, well-spaced widget
// the screens use so we don't repeat the same Card/Row pattern eight times.
// ---------------------------------------------------------------------------

@Composable
fun QrCard(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = BgElevated),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) { content() }
    }
}

@Composable
fun QrSectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 2.sp),
        color = TextSecondary,
        modifier = modifier,
    )
}

@Composable
fun QrEmptyState(
    icon: ImageVector,
    title: String,
    body: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 64.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = TextSecondary,
            modifier = Modifier.size(56.dp),
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(title, color = TextPrimary, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            body,
            color = TextSecondary,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

@Composable
fun QrSkeletonRow() {
    // Compose shimmer alternative without an extra dep: a flat translucent
    // bar. Lighter than full shimmer and renders identically on the dark
    // theme.
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(64.dp)
            .padding(vertical = 4.dp)
            .background(Color.White.copy(alpha = 0.04f), RoundedCornerShape(12.dp)),
    )
}

@Composable
fun QrStatusDot(color: Color, contentDescription: String?) {
    Box(
        modifier = Modifier
            .size(10.dp)
            .background(color, shape = androidx.compose.foundation.shape.CircleShape)
            .semantics { if (contentDescription != null) this.contentDescription = contentDescription },
    )
}

/**
 * A standard "tap to do X" row used inside an About / Settings list. Single
 * tap target, 56dp tall, left icon + label, right chevron.
 */
@Composable
fun QrSettingRow(
    icon: ImageVector,
    label: String,
    trailing: String? = null,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { role = Role.Button }
            .padding(vertical = 4.dp),
        colors = CardDefaults.cardColors(containerColor = BgElevated),
        shape = RoundedCornerShape(14.dp),
        onClick = onClick,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, tint = Accent, modifier = Modifier.size(22.dp))
            Spacer(modifier = Modifier.width(14.dp))
            Text(label, color = TextPrimary, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            if (trailing != null) {
                Text(trailing, color = TextSecondary, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

// Convenience aliases so screens read cleanly: `QrSpacer.M`, etc.
object QrSpacer {
    @Composable fun S() = Spacer(modifier = Modifier.height(4.dp))
    @Composable fun M() = Spacer(modifier = Modifier.height(8.dp))
    @Composable fun L() = Spacer(modifier = Modifier.height(16.dp))
    @Composable fun XL() = Spacer(modifier = Modifier.height(24.dp))
}

