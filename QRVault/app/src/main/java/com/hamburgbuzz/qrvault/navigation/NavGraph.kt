package com.hamburgbuzz.qrvault.navigation

import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.hamburgbuzz.qrvault.ui.screens.*

sealed class Screen(val route: String) {
    object Home : Screen("home")
    object Doors : Screen("doors")
    object Audit : Screen("audit")
    object Settings : Screen("settings")
    object Login : Screen("login")
    object About : Screen("about")
    object Devices : Screen("devices")
    object Health : Screen("health")
    object Invitations : Screen("invitations")
    object Licenses : Screen("licenses")
    object Webhooks : Screen("webhooks")
    object ForgotPassword : Screen("forgot_password?email={email}") {
        fun create(email: String): String =
            "forgot_password?email=" + java.net.URLEncoder.encode(email, "UTF-8")
    }
    object ResetPassword : Screen("reset_password")
}

@Composable
fun NavGraph(
    navController: NavHostController,
    startDestination: String = Screen.Login.route
) {
    val onSignOutAction: () -> Unit = {
        navController.navigate(Screen.Login.route) {
            popUpTo(0) { inclusive = true }
        }
    }

    NavHost(
        navController = navController,
        startDestination = startDestination,
        enterTransition = {
            fadeIn(animationSpec = tween(300)) + scaleIn(initialScale = 0.95f, animationSpec = tween(300))
        },
        exitTransition = {
            fadeOut(animationSpec = tween(300))
        },
        popEnterTransition = {
            fadeIn(animationSpec = tween(300)) + scaleIn(initialScale = 0.95f, animationSpec = tween(300))
        },
        popExitTransition = {
            fadeOut(animationSpec = tween(300))
        }
    ) {
        composable(Screen.Login.route) {
            LoginScreen(
                onLoginSuccess = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                },
                onNavigateToForgotPassword = { email ->
                    navController.navigate(Screen.ForgotPassword.create(email))
                },
            )
        }

        composable(
            route = Screen.ForgotPassword.route,
            arguments = listOf(
                androidx.navigation.navArgument("email") {
                    type = androidx.navigation.NavType.StringType
                    defaultValue = ""
                    nullable = false
                },
            ),
        ) { backStackEntry ->
            val raw = backStackEntry.arguments?.getString("email").orEmpty()
            val email = runCatching { java.net.URLDecoder.decode(raw, "UTF-8") }.getOrDefault("")
            ForgotPasswordScreen(
                onNavigateBack = { navController.popBackStack() },
                initialEmail = email,
            )
        }

        composable(Screen.ResetPassword.route) {
            ResetPasswordScreen(
                onPasswordUpdated = {
                    // After update, drop the recovery session and bounce to login.
                    navController.navigate(Screen.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onCancel = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.Home.route) {
            HomeScreen(
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) },
                onSignOut = onSignOutAction,
                onNavigateToInvitations = { navController.navigate(Screen.Invitations.route) },
            )
        }
        
        composable(Screen.Doors.route) {
            DoorsScreen(
                onNavigateBack = { navController.popBackStack() },
                onSignOut = onSignOutAction
            )
        }
        
        composable(Screen.Audit.route) {
            AuditScreen(
                onNavigateBack = { navController.popBackStack() },
                onSignOut = onSignOutAction
            )
        }
        
        composable(Screen.Settings.route) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() },
                onSignOut = onSignOutAction,
                onNavigateToHealth      = { navController.navigate(Screen.Health.route) },
                onNavigateToDevices     = { navController.navigate(Screen.Devices.route) },
                onNavigateToInvitations = { navController.navigate(Screen.Invitations.route) },
                onNavigateToAbout       = { navController.navigate(Screen.About.route) },
                onNavigateToWebhooks    = { navController.navigate(Screen.Webhooks.route) },
            )
        }

        composable(Screen.Webhooks.route) {
            WebhooksScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.About.route) {
            AboutScreen(
                onNavigateBack = { navController.popBackStack() },
                onAccountDeleted = onSignOutAction,
                onNavigateToLicenses = { navController.navigate(Screen.Licenses.route) },
            )
        }

        composable(Screen.Licenses.route) {
            LicensesScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.Devices.route) {
            DevicesScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.Health.route) {
            HealthScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.Invitations.route) {
            InvitationsScreen(onNavigateBack = { navController.popBackStack() })
        }
    }
}
