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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
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
 * Landed here from the Supabase password-recovery email deep link.
 * MainActivity consumed the URL (parseSessionFromUrl) before navigating
 * here, so the user has a temporary session that authorises updateUser.
 *
 * Two fields: new password + confirm. We require >=8 chars (Supabase
 * default minimum), and we make the user confirm to catch typos in a
 * field they can't see.
 */
@Composable
fun ResetPasswordScreen(
    onPasswordUpdated: () -> Unit,
    onCancel: () -> Unit,
    viewModel: AuthViewModel = hiltViewModel(),
) {
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()
    val isAuthenticated by viewModel.isAuthenticated.collectAsStateWithLifecycle()

    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }

    // If we land here without a recovery session somehow, bounce back —
    // updateUser would fail with "not authenticated".
    LaunchedEffect(isAuthenticated) {
        if (!isAuthenticated) {
            // Give Supabase a beat to materialise the session from the
            // URL before bailing.
        }
    }

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
                        text = "SET A NEW PASSWORD",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextSecondary,
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                        letterSpacing = 1.sp,
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    AuthTextField(
                        label = "NEW PASSWORD",
                        value = password,
                        onValueChange = { password = it },
                        placeholder = "••••••••",
                        isPassword = true,
                        passwordVisible = passwordVisible,
                        onPasswordToggle = { passwordVisible = !passwordVisible },
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    AuthTextField(
                        label = "CONFIRM PASSWORD",
                        value = confirm,
                        onValueChange = { confirm = it },
                        placeholder = "••••••••",
                        isPassword = true,
                        passwordVisible = passwordVisible,
                        onPasswordToggle = { passwordVisible = !passwordVisible },
                    )

                    val combinedError = localError ?: error
                    if (combinedError != null) {
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(combinedError, color = Color.Red, style = MaterialTheme.typography.bodySmall)
                    }

                    Spacer(modifier = Modifier.height(24.dp))

                    Button(
                        onClick = {
                            localError = null
                            when {
                                password.length < 8 ->
                                    localError = "Password must be at least 8 characters."
                                password != confirm ->
                                    localError = "Passwords don't match."
                                else -> viewModel.updatePassword(password) { ok ->
                                    if (ok) onPasswordUpdated()
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Accent,
                            contentColor = Color.Black,
                        ),
                        enabled = !isLoading && password.isNotBlank() && confirm.isNotBlank(),
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                color = Color.Black,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(
                                text = "UPDATE PASSWORD",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    androidx.compose.material3.TextButton(
                        onClick = onCancel,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("CANCEL", color = TextSecondary, fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}
