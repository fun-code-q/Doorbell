package com.hamburgbuzz.qrvault.ui.screens

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.hamburgbuzz.qrvault.ui.theme.*
import com.hamburgbuzz.qrvault.ui.viewmodel.AuthViewModel

@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit,
    onNavigateToForgotPassword: (email: String) -> Unit = {},
    viewModel: AuthViewModel = hiltViewModel()
) {
    val isAuthenticated by viewModel.isAuthenticated.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()
    val isSignUp by viewModel.isSignUp.collectAsStateWithLifecycle()

    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }

    LaunchedEffect(isAuthenticated) {
        if (isAuthenticated) {
            onLoginSuccess()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(BgObsidian)
    ) {
        // Decorative background glows
        GlowBackground()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(32.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Logo Section
            LogoHeader()

            Spacer(modifier = Modifier.height(48.dp))

            // Auth Card
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(28.dp),
                color = BgElevated,
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF27272A).copy(alpha = 0.5f))
            ) {
                Column(
                    modifier = Modifier.padding(24.dp)
                ) {
                    Text(
                        text = if (isSignUp) "CREATE YOUR VAULT" else "WELCOME BACK",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextSecondary,
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                        letterSpacing = 1.sp
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    // Email Field
                    AuthTextField(
                        label = "EMAIL",
                        value = email,
                        onValueChange = { email = it },
                        placeholder = "you@example.com",
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // Password Field
                    AuthTextField(
                        label = "PASSWORD",
                        value = password,
                        onValueChange = { password = it },
                        placeholder = "••••••••",
                        isPassword = true,
                        passwordVisible = passwordVisible,
                        onPasswordToggle = { passwordVisible = !passwordVisible }
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    if (error != null) {
                        Text(
                            text = error!!,
                            color = if (error!!.contains("created")) Success else Color.Red,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(bottom = 16.dp)
                        )
                    }

                    // Submit Button
                    Button(
                        onClick = { viewModel.authenticate(email, password) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Accent,
                            contentColor = Color.Black
                        ),
                        enabled = !isLoading
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                color = Color.Black,
                                strokeWidth = 2.dp
                            )
                        } else {
                            Text(
                                text = if (isSignUp) "SIGN UP" else "SIGN IN",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    // Forgot-password link — only in sign-in mode (we have
                    // nothing to recover before the account exists).
                    if (!isSignUp) {
                        Spacer(modifier = Modifier.height(8.dp))
                        TextButton(
                            onClick = { onNavigateToForgotPassword(email) },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                text = "FORGOT PASSWORD?",
                                color = TextSecondary,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 1.sp,
                            )
                        }
                    } else {
                        Spacer(modifier = Modifier.height(24.dp))
                    }

                    Spacer(modifier = Modifier.height(24.dp))

                    // Highlighted Toggle Options
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = Color.Black.copy(alpha = 0.3f),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Row(
                            modifier = Modifier.padding(4.dp),
                            horizontalArrangement = Arrangement.Center
                        ) {
                            // SIGN IN option
                            Surface(
                                modifier = Modifier
                                    .weight(1f)
                                    .clickable { if (isSignUp) viewModel.toggleMode() },
                                color = if (!isSignUp) Accent else Color.Transparent,
                                shape = RoundedCornerShape(10.dp)
                            ) {
                                Text(
                                    text = "SIGN IN",
                                    modifier = Modifier.padding(vertical = 12.dp),
                                    textAlign = TextAlign.Center,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = if (!isSignUp) Color.Black else TextSecondary
                                )
                            }
                            
                            // CREATE ACCOUNT option
                            Surface(
                                modifier = Modifier
                                    .weight(1f)
                                    .clickable { if (!isSignUp) viewModel.toggleMode() },
                                color = if (isSignUp) Accent else Color.Transparent,
                                shape = RoundedCornerShape(10.dp)
                            ) {
                                Text(
                                    text = "CREATE ACCOUNT",
                                    modifier = Modifier.padding(vertical = 12.dp),
                                    textAlign = TextAlign.Center,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = if (isSignUp) Color.Black else TextSecondary
                                )
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(48.dp))
            
            Text(
                text = "QR VAULT v1.0",
                style = MaterialTheme.typography.labelSmall,
                color = TextSecondary.copy(alpha = 0.5f)
            )
        }
    }
}

@Composable
fun GlowBackground() {
    val infiniteTransition = rememberInfiniteTransition(label = "GlowTransition")
    val alphaTop by infiniteTransition.animateFloat(
        initialValue = 0.2f,
        targetValue = 0.4f,
        animationSpec = infiniteRepeatable(
            animation = tween(4000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "AlphaTop"
    )
    val alphaBottom by infiniteTransition.animateFloat(
        initialValue = 0.1f,
        targetValue = 0.3f,
        animationSpec = infiniteRepeatable(
            animation = tween(5000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "AlphaBottom"
    )

    Box(modifier = Modifier.fillMaxSize()) {
        // Top Right Glow
        Box(
            modifier = Modifier
                .offset(x = 100.dp, y = (-50).dp)
                .size(300.dp)
                .blur(80.dp)
                .background(
                    Brush.radialGradient(
                        colors = listOf(Accent.copy(alpha = alphaTop), Color.Transparent)
                    )
                )
        )

        // Bottom Left Glow
        Box(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .offset(x = (-50).dp, y = 50.dp)
                .size(250.dp)
                .blur(80.dp)
                .background(
                    Brush.radialGradient(
                        colors = listOf(Accent.copy(alpha = alphaBottom), Color.Transparent)
                    )
                )
        )
    }
}

@Composable
fun LogoHeader() {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Text(
                text = "⬡",
                style = MaterialTheme.typography.displaySmall,
                color = Accent,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = "QR VAULT",
                style = MaterialTheme.typography.displaySmall,
                color = Accent,
                fontWeight = FontWeight.Black,
                letterSpacing = (-2).sp
            )
        }
        Text(
            text = "OWNER DASHBOARD",
            style = MaterialTheme.typography.labelSmall,
            color = TextSecondary,
            letterSpacing = 4.sp,
            modifier = Modifier.padding(top = 8.dp)
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    isPassword: Boolean = false,
    passwordVisible: Boolean = false,
    onPasswordToggle: () -> Unit = {},
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default
) {
    Column {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = TextSecondary,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(bottom = 8.dp)
        )
        TextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text(placeholder, color = TextSecondary.copy(alpha = 0.5f)) },
            visualTransformation = if (isPassword && !passwordVisible) PasswordVisualTransformation() else VisualTransformation.None,
            trailingIcon = {
                if (isPassword) {
                    IconButton(onClick = onPasswordToggle) {
                        Icon(
                            imageVector = if (passwordVisible) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                            contentDescription = if (passwordVisible) "Hide password" else "Show password",
                            tint = TextSecondary
                        )
                    }
                }
            },
            keyboardOptions = if (isPassword) KeyboardOptions(keyboardType = KeyboardType.Password) else keyboardOptions,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Color.Black.copy(alpha = 0.4f),
                unfocusedContainerColor = Color.Black.copy(alpha = 0.4f),
                focusedIndicatorColor = Accent,
                unfocusedIndicatorColor = Color.Transparent,
                cursorColor = Accent,
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White
            ),
            shape = RoundedCornerShape(12.dp),
            singleLine = true
        )
    }
}
