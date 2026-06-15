package com.hamburgbuzz.qrvault.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgElevated
import com.hamburgbuzz.qrvault.ui.theme.BgObsidian
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary
import com.hamburgbuzz.qrvault.ui.viewmodel.AuthViewModel

/**
 * "Forgot password?" screen. Takes the user's email, fires
 * AuthViewModel.sendPasswordReset, and shows the "check your inbox"
 * confirmation. The recovery link Supabase mails is a
 * `qrvault://auth/reset` deep link that re-opens this app at
 * ResetPasswordScreen (via MainActivity's NEW_INTENT handler).
 */
@Composable
fun ForgotPasswordScreen(
    onNavigateBack: () -> Unit,
    initialEmail: String = "",
    viewModel: AuthViewModel = hiltViewModel(),
) {
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()

    var email by remember { mutableStateOf(initialEmail) }
    var sent by remember { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxSize().background(BgObsidian)) {
        GlowBackground()
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(32.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            LogoHeader()
            Spacer(modifier = Modifier.height(40.dp))

            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(28.dp),
                color = BgElevated,
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF27272A).copy(alpha = 0.5f)),
            ) {
                Column(modifier = Modifier.padding(24.dp)) {
                    Text(
                        text = if (sent) "CHECK YOUR INBOX" else "RESET PASSWORD",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextSecondary,
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                        letterSpacing = 1.sp,
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    if (!sent) {
                        Text(
                            text = "We'll email you a recovery link. Tap it on this phone and the app will reopen to set a new password.",
                            color = TextSecondary,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
                        )

                        AuthTextField(
                            label = "EMAIL",
                            value = email,
                            onValueChange = { email = it },
                            placeholder = "you@example.com",
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        )

                        if (error != null) {
                            Spacer(modifier = Modifier.height(12.dp))
                            Text(error!!, color = Color.Red, style = MaterialTheme.typography.bodySmall)
                        }

                        Spacer(modifier = Modifier.height(24.dp))

                        Button(
                            onClick = {
                                viewModel.sendPasswordReset(email) { ok ->
                                    if (ok) sent = true
                                }
                            },
                            modifier = Modifier.fillMaxWidth().height(56.dp),
                            shape = RoundedCornerShape(16.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Accent,
                                contentColor = Color.Black,
                            ),
                            enabled = !isLoading && email.isNotBlank(),
                        ) {
                            if (isLoading) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(24.dp),
                                    color = Color.Black,
                                    strokeWidth = 2.dp,
                                )
                            } else {
                                Text(
                                    text = "SEND RECOVERY EMAIL",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    } else {
                        Icon(
                            Icons.Outlined.MarkEmailRead,
                            contentDescription = null,
                            tint = Accent,
                            modifier = Modifier.size(64.dp).align(Alignment.CenterHorizontally),
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = "Sent to $email. The link is good for one hour and works on this device only.",
                            color = TextSecondary,
                            style = MaterialTheme.typography.bodyMedium,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth(),
                        )

                        Spacer(modifier = Modifier.height(24.dp))

                        Button(
                            onClick = onNavigateBack,
                            modifier = Modifier.fillMaxWidth().height(56.dp),
                            shape = RoundedCornerShape(16.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color.Black),
                        ) {
                            Text("BACK TO SIGN IN", fontWeight = FontWeight.Bold)
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    if (!sent) {
                        TextButton(onClick = onNavigateBack, modifier = Modifier.fillMaxWidth()) {
                            Text("CANCEL", color = TextSecondary, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
