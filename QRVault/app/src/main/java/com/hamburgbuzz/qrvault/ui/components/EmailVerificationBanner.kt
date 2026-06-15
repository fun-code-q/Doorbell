package com.hamburgbuzz.qrvault.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MarkEmailUnread
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.TextPrimary
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary
import com.hamburgbuzz.qrvault.ui.viewmodel.EmailVerificationViewModel

/**
 * Renders an amber banner when the signed-in user hasn't yet clicked
 * their confirmation email. Auto-hides once the session reflects a
 * confirmed email. Includes a "Resend" affordance for users who didn't
 * see the original mail.
 *
 * Render this at the top of HomeScreen — features that rely on
 * confirmed-only state (e.g. inviting members) should also disable
 * themselves when `confirmed == false`, but the banner is the universal
 * nudge.
 */
@Composable
fun EmailVerificationBanner(
    viewModel: EmailVerificationViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var resent by remember { mutableStateOf(false) }

    if (state.confirmed || state.email.isNullOrBlank()) return

    val amber = Color(0xFFFACC15)
    val amberBg = amber.copy(alpha = 0.12f)
    val amberBorder = amber.copy(alpha = 0.4f)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(amberBg, RoundedCornerShape(14.dp))
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.MarkEmailUnread,
            contentDescription = null,
            tint = amber,
            modifier = Modifier.size(28.dp),
        )
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                "Verify your email",
                color = TextPrimary,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "Tap the link we sent to ${state.email}. Until then, invites and shared keys are paused.",
                color = TextSecondary,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        TextButton(onClick = {
            viewModel.resend { ok -> if (ok) resent = true }
        }) {
            Text(
                if (resent) "SENT" else "RESEND",
                color = Accent,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
