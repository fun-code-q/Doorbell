package com.hamburgbuzz.qrvault.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.BatteryAlert
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.RocketLaunch
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import com.hamburgbuzz.qrvault.R
import com.hamburgbuzz.qrvault.ui.theme.*

enum class WizardStep {
    BATTERY,
    OVERLAY,
    OEM_AUTOSTART,
    COMPLETE
}

@OptIn(ExperimentalAnimationApi::class)
@Composable
fun PowerUserWizardScreen(onComplete: () -> Unit) {
    var currentStep by remember { mutableStateOf(WizardStep.BATTERY) }
    val context = LocalContext.current

    // The OEM autostart screens have no read-back API. We can only show
    // the step on devices from known-aggressive OEMs and trust the user
    // to flip it. Mark "done" once they tap through, locally.
    val oemRoute = remember { com.hamburgbuzz.qrvault.util.OemAutostart.matchingRoute(context) }
    val hasOemStep = oemRoute != null
    var oemVisited by remember { mutableStateOf(false) }

    // Refresh permission states when returning from settings
    var batteryOptimizedIgnored by remember { mutableStateOf(isBatteryOptimizationIgnored(context)) }
    var overlayPermissionGranted by remember { mutableStateOf(isOverlayPermissionGranted(context)) }

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) {
        batteryOptimizedIgnored = isBatteryOptimizationIgnored(context)
        overlayPermissionGranted = isOverlayPermissionGranted(context)
    }

    LaunchedEffect(batteryOptimizedIgnored, overlayPermissionGranted, oemVisited) {
        val oemDone = !hasOemStep || oemVisited
        currentStep = when {
            !batteryOptimizedIgnored -> WizardStep.BATTERY
            !overlayPermissionGranted -> WizardStep.OVERLAY
            !oemDone -> WizardStep.OEM_AUTOSTART
            else -> WizardStep.COMPLETE
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = BgObsidian
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(48.dp))

            Text(
                text = stringResource(R.string.wizard_title),
                style = Typography.displayLarge,
                color = Accent,
                textAlign = TextAlign.Center
            )

            Text(
                text = stringResource(R.string.wizard_subtitle),
                style = Typography.bodyMedium,
                color = TextSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp)
            )

            Spacer(modifier = Modifier.height(48.dp))

            AnimatedContent(
                targetState = currentStep,
                transitionSpec = {
                    if (targetState.ordinal > initialState.ordinal) {
                        (slideInHorizontally(initialOffsetX = { it }) + fadeIn()) togetherWith
                                (slideOutHorizontally(targetOffsetX = { -it }) + fadeOut())
                    } else {
                        (slideInHorizontally(initialOffsetX = { -it }) + fadeIn()) togetherWith
                                (slideOutHorizontally(targetOffsetX = { it }) + fadeOut())
                    }.using(SizeTransform(clip = false))
                },
                label = "WizardStepTransition"
            ) { step ->
                StepContent(
                    step = step,
                    isBatteryGranted = batteryOptimizedIgnored,
                    isOverlayGranted = overlayPermissionGranted,
                    isOemDone = !hasOemStep || oemVisited,
                    onRequestBattery = {
                        val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                        launcher.launch(intent)
                    },
                    onRequestOverlay = {
                        val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).apply {
                            data = Uri.parse("package:${context.packageName}")
                        }
                        launcher.launch(intent)
                    },
                    onRequestOemAutostart = {
                        // openAutostartIfApplicable returns true if it
                        // could launch the OEM screen. Either way, mark
                        // visited so the wizard moves on — the user has
                        // received the explanation.
                        com.hamburgbuzz.qrvault.util.OemAutostart.openAutostartIfApplicable(context)
                        oemVisited = true
                    },
                    onFinish = onComplete
                )
            }

            Spacer(modifier = Modifier.weight(1f))
            
            // Progress indicators
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                WizardProgressDot(active = currentStep == WizardStep.BATTERY, completed = batteryOptimizedIgnored)
                WizardProgressDot(active = currentStep == WizardStep.OVERLAY, completed = overlayPermissionGranted)
                if (hasOemStep) {
                    WizardProgressDot(active = currentStep == WizardStep.OEM_AUTOSTART, completed = oemVisited)
                }
                WizardProgressDot(
                    active = currentStep == WizardStep.COMPLETE,
                    completed = batteryOptimizedIgnored && overlayPermissionGranted && (!hasOemStep || oemVisited),
                )
            }
            
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
fun StepContent(
    step: WizardStep,
    isBatteryGranted: Boolean,
    isOverlayGranted: Boolean,
    isOemDone: Boolean,
    onRequestBattery: () -> Unit,
    onRequestOverlay: () -> Unit,
    onRequestOemAutostart: () -> Unit,
    onFinish: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(BgSurface, RoundedCornerShape(24.dp))
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        val icon: ImageVector
        val title: String
        val description: String
        val buttonText: String
        val onAction: () -> Unit
        val isGranted: Boolean

        when (step) {
            WizardStep.BATTERY -> {
                icon = Icons.Rounded.BatteryAlert
                title = stringResource(R.string.battery_title)
                description = stringResource(R.string.battery_desc)
                buttonText = stringResource(R.string.battery_button)
                onAction = onRequestBattery
                isGranted = isBatteryGranted
            }
            WizardStep.OVERLAY -> {
                icon = Icons.Rounded.Layers
                title = stringResource(R.string.overlay_title)
                description = stringResource(R.string.overlay_desc)
                buttonText = stringResource(R.string.overlay_button)
                onAction = onRequestOverlay
                isGranted = isOverlayGranted
            }
            WizardStep.OEM_AUTOSTART -> {
                icon = Icons.Rounded.RocketLaunch
                title = stringResource(R.string.oem_autostart_title)
                description = stringResource(R.string.oem_autostart_desc)
                buttonText = stringResource(R.string.oem_autostart_button)
                onAction = onRequestOemAutostart
                isGranted = isOemDone
            }
            WizardStep.COMPLETE -> {
                icon = Icons.Rounded.CheckCircle
                title = stringResource(R.string.complete_title)
                description = stringResource(R.string.complete_desc)
                buttonText = stringResource(R.string.complete_button)
                onAction = onFinish
                isGranted = true
            }
        }

        Icon(
            imageVector = icon,
            contentDescription = stringResource(R.string.content_desc_wizard_icon),
            tint = if (isGranted) Accent else TextSecondary,
            modifier = Modifier.size(64.dp)
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = title,
            style = Typography.headlineLarge,
            color = TextPrimary,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = description,
            style = Typography.bodyLarge,
            color = TextSecondary,
            textAlign = TextAlign.Center,
            lineHeight = 22.sp
        )

        Spacer(modifier = Modifier.height(32.dp))

        Button(
            onClick = onAction,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Accent,
                contentColor = BgObsidian
            ),
            shape = RoundedCornerShape(16.dp)
        ) {
            Text(
                text = buttonText,
                style = Typography.titleLarge.copy(fontWeight = FontWeight.Bold)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Icon(Icons.Rounded.ChevronRight, contentDescription = stringResource(R.string.content_desc_next))
        }
        
        if (step != WizardStep.COMPLETE) {
            TextButton(
                onClick = { /* Could add a skip but not recommended for power user flow */ },
                modifier = Modifier.padding(top = 8.dp)
            ) {
                Text(stringResource(R.string.why_needed), color = TextSecondary, style = Typography.labelMedium)
            }
        }
    }
}

@Composable
fun WizardProgressDot(active: Boolean, completed: Boolean) {
    val color = when {
        completed -> Accent
        active -> Accent.copy(alpha = 0.5f)
        else -> BgElevated
    }
    Box(
        modifier = Modifier
            .size(if (active) 12.dp else 8.dp)
            .background(color, RoundedCornerShape(50))
    )
}

private fun isBatteryOptimizationIgnored(context: Context): Boolean {
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        powerManager.isIgnoringBatteryOptimizations(context.packageName)
    } else {
        true
    }
}

private fun isOverlayPermissionGranted(context: Context): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Settings.canDrawOverlays(context)
    } else {
        true
    }
}
