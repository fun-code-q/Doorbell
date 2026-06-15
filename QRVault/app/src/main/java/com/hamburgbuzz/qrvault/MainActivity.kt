package com.hamburgbuzz.qrvault

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.FragmentActivity
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.DoorSliding
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.rounded.History
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.hamburgbuzz.qrvault.navigation.NavGraph
import com.hamburgbuzz.qrvault.navigation.Screen
import com.hamburgbuzz.qrvault.ui.theme.Accent
import com.hamburgbuzz.qrvault.ui.theme.BgElevated
import com.hamburgbuzz.qrvault.ui.theme.BgObsidian
import com.hamburgbuzz.qrvault.ui.theme.QRVaultTheme
import com.hamburgbuzz.qrvault.ui.theme.TextSecondary
import com.hamburgbuzz.qrvault.ui.viewmodel.AuthViewModel
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : FragmentActivity() {

    private val requestNotificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* ignore result */ }

    /**
     * Recovery-link state. Set when MainActivity's onCreate / onNewIntent
     * receives a `qrvault://auth/reset#access_token=...` intent. The
     * Compose tree reacts by navigating to ResetPasswordScreen.
     */
    private val recoveryUrl = mutableStateOf<String?>(null)

    /** True while the user has not yet passed the biometric/PIN gate this session. */
    private val locked = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        // Install the Splash Screen API BEFORE super.onCreate so the system
        // splash transitions to Compose without a black flash. The function
        // is an extension on ComponentActivity (which FragmentActivity is).
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        requestNotificationPermissionIfNeeded()
        handleRecoveryIntent(intent)

        // App-lock: lock now, unlock after the user passes BiometricPrompt.
        // We always prompt on cold start when the toggle is on; the
        // re-prompt grace window only applies to background→foreground.
        locked.value = com.hamburgbuzz.qrvault.util.AppLockPrefs.isEnabled(this)
        if (locked.value) showLockPrompt()

        setContent {
            QRVaultTheme {
                val authViewModel: AuthViewModel = hiltViewModel()
                val isAuthenticated by authViewModel.isAuthenticated.collectAsState()
                val isCheckingSession by authViewModel.isCheckingSession.collectAsState()

                val isLocked by locked

                if (isCheckingSession) {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Accent)
                    }
                } else if (isLocked) {
                    // Render an interactive locked screen with a tap-to-retry trigger
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .clickable { showLockPrompt() },
                        contentAlignment = Alignment.Center,
                    ) {
                        androidx.compose.foundation.layout.Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center
                        ) {
                            androidx.compose.material3.Icon(
                                imageVector = androidx.compose.material.icons.Icons.Outlined.Lock,
                                contentDescription = "Locked",
                                tint = Accent,
                                modifier = Modifier.padding(bottom = 16.dp)
                            )
                            androidx.compose.material3.Text(
                                "QRVault is Locked",
                                style = androidx.compose.material3.MaterialTheme.typography.titleMedium,
                                color = androidx.compose.material3.MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.padding(bottom = 8.dp)
                            )
                            androidx.compose.material3.Text(
                                "Tap anywhere to unlock",
                                style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
                                color = TextSecondary
                            )
                        }
                    }
                } else {
                    val navController = rememberNavController()
                    val navBackStackEntry by navController.currentBackStackEntryAsState()
                    val currentRoute = navBackStackEntry?.destination?.route
                    val pendingRecoveryUrl by recoveryUrl

                    // Consume the recovery URL once: parseSessionFromUrl
                    // establishes a temporary session, then navigate to
                    // ResetPasswordScreen.
                    LaunchedEffect(pendingRecoveryUrl) {
                        val url = pendingRecoveryUrl ?: return@LaunchedEffect
                        authViewModel.consumeRecoveryUrl(url) { ok ->
                            recoveryUrl.value = null
                            if (ok) {
                                navController.navigate(Screen.ResetPassword.route) {
                                    launchSingleTop = true
                                }
                            }
                        }
                    }

                    Scaffold(
                        modifier = Modifier.fillMaxSize(),
                        containerColor = BgObsidian,
                        bottomBar = {
                            if (currentRoute != Screen.Login.route &&
                                currentRoute != Screen.ResetPassword.route &&
                                currentRoute?.startsWith("forgot_password") != true &&
                                currentRoute != null
                            ) {
                                AppBottomNavigation(navController)
                            }
                        },
                    ) { innerPadding ->
                        Box(modifier = Modifier.padding(innerPadding)) {
                            NavGraph(
                                navController = navController,
                                startDestination = if (isAuthenticated) Screen.Home.route else Screen.Login.route,
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Recovery emails open the app via the existing task, not via
        // onCreate. setIntent so getIntent reflects the new payload.
        setIntent(intent)
        handleRecoveryIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        // If the user backgrounded the app for longer than the re-prompt
        // window and the lock is enabled, re-lock and prompt again.
        if (!locked.value && com.hamburgbuzz.qrvault.util.AppLockPrefs.needsPrompt(this)) {
            locked.value = true
            showLockPrompt()
        }
    }

    override fun onPause() {
        super.onPause()
        // Persist the last successful auth timestamp so a quick switch
        // back to the app doesn't re-prompt. We mark only when currently
        // unlocked so a swipe-away while locked doesn't grant a freebie.
        if (!locked.value) {
            com.hamburgbuzz.qrvault.util.AppLockPrefs.markAuthed(this)
        }
    }

    private fun showLockPrompt() {
        // BiometricGate suspends until the user authenticates. Result
        // false allows the user to stay on the locked screen and retry.
        lifecycleScope.launch {
            val ok = com.hamburgbuzz.qrvault.util.BiometricGate.prompt(
                activity = this@MainActivity,
                title = getString(R.string.app_lock_title),
                subtitle = getString(R.string.app_lock_subtitle),
            )
            if (ok) {
                com.hamburgbuzz.qrvault.util.AppLockPrefs.markAuthed(this@MainActivity)
                locked.value = false
            }
        }
    }

    /**
     * `qrvault://auth/reset#access_token=...&type=recovery` lands here.
     * We hand the entire URL to Supabase via consumeRecoveryUrl — it
     * parses the fragment, establishes a recovery-mode session, and the
     * Compose tree then routes to ResetPasswordScreen.
     */
    private fun handleRecoveryIntent(intent: Intent?) {
        val data: Uri = intent?.data ?: return
        if (data.scheme.equals("qrvault", ignoreCase = true) &&
            data.host.equals("auth", ignoreCase = true) &&
            data.path?.contains("reset", ignoreCase = true) == true
        ) {
            recoveryUrl.value = data.toString()
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

@Composable
private fun AppBottomNavigation(navController: androidx.navigation.NavHostController) {
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    val items = listOf(
        NavigationItem(stringResource(R.string.nav_home),     Screen.Home.route,     Icons.Outlined.Dashboard),
        NavigationItem(stringResource(R.string.nav_doors),    Screen.Doors.route,    Icons.Outlined.DoorSliding),
        NavigationItem(stringResource(R.string.nav_audit),    Screen.Audit.route,    Icons.Rounded.History),
        NavigationItem(stringResource(R.string.nav_settings), Screen.Settings.route, Icons.Outlined.Settings),
    )

    NavigationBar(
        containerColor = BgElevated,
        contentColor = TextSecondary,
        tonalElevation = 0.dp,
    ) {
        items.forEach { item ->
            val selected = currentDestination?.hierarchy?.any { it.route == item.route } == true
            NavigationBarItem(
                selected = selected,
                onClick = {
                    if (!selected) {
                        navController.navigate(item.route) {
                            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    }
                },
                icon = { Icon(item.icon, contentDescription = item.label) },
                label = { Text(item.label) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = Accent,
                    selectedTextColor = Accent,
                    indicatorColor = Accent.copy(alpha = 0.1f),
                    unselectedIconColor = TextSecondary,
                    unselectedTextColor = TextSecondary,
                ),
            )
        }
    }
}

private data class NavigationItem(
    val label: String,
    val route: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
)
