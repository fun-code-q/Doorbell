// Android Permission Helper for QR Vault
// Manages high-privilege Android permissions like Overlay and Battery Optimization.

import { Platform, Linking, Alert } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Battery from 'expo-battery';

export const AndroidPermissionHelper = {
  /**
   * Opens the system settings for "Display over other apps" (Overlay).
   * This is required for the incoming ring screen to wake up the phone.
   */
  async requestOverlayPermission() {
    if (Platform.OS !== 'android') return;

    Alert.alert(
      'Display over other apps',
      'QR Vault needs this permission to show you the Answer/Decline screen even when you are using other apps or the phone is locked. Please find QR Vault in the list and enable "Allow display over other apps".',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Settings',
          onPress: () => {
            IntentLauncher.startActivityAsync(
              IntentLauncher.ActivityAction.MANAGE_OVERLAY_PERMISSION,
              { data: 'package:fun.code.q.doorbell.owner' } // Update with your actual package name if different
            );
          },
        },
      ]
    );
  },

  /**
   * Prompts the user to disable battery optimizations for the app.
   * This ensures the background task doesn't get "killed" by the system.
   */
  async requestIgnoreBatteryOptimizations() {
    if (Platform.OS !== 'android') return;

    const isOptimizing = await Battery.isBatteryOptimizationEnabledAsync();
    if (!isOptimizing) return;

    Alert.alert(
      'Background Reliability',
      'To ensure you never miss a doorbell ring, please disable battery optimizations for QR Vault. This allows the app to listen for rings even when the screen is off.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Settings',
          onPress: () => {
            IntentLauncher.startActivityAsync(
              IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS
            );
          },
        },
      ]
    );
  },

  /**
   * Opens the system settings for the app to manage notification channels.
   */
  async openNotificationSettings() {
    if (Platform.OS !== 'android') return;
    
    IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS,
      { data: 'package:fun.code.q.doorbell.owner' }
    );
  },

  /**
   * Opens the app details page where users can manually toggle Full-Screen Intents.
   */
  async openFullScreenIntentSettings() {
    if (Platform.OS !== 'android') return;

    IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data: 'package:fun.code.q.doorbell.owner' }
    );
  },
};
