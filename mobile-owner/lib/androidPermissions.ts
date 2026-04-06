import { Platform, Linking } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';

/**
 * QR Vault - Android Permission Helper (2026)
 * Handles high-privilege permissions required for reliable doorbell rings.
 */

export const AndroidPermissionHelper = {
  getPackageName() {
    return Application.applicationId || 'com.qrdoorbell.owner';
  },

  /**
   * Opens the "Display over other apps" settings page for this app.
   */
  async requestOverlayPermission() {
    if (Platform.OS !== 'android') return;
    const pkg = AndroidPermissionHelper.getPackageName();

    try {
      await IntentLauncher.startActivityAsync(
        'android.settings.action.MANAGE_OVERLAY_PERMISSION',
        { data: `package:${pkg}` }
      );
    } catch (e) {
      // Fallback if the specific intent fails
      await Linking.openSettings();
    }
  },

  /**
   * Opens the "Battery Optimization" settings page.
   * Note: We cannot programmatically check this status without a custom native module,
   * but we can prompt the user to select "Don't optimize" for our app.
   */
  async requestIgnoreBatteryOptimizations() {
    if (Platform.OS !== 'android') return;
    const pkg = AndroidPermissionHelper.getPackageName();

    try {
      await IntentLauncher.startActivityAsync(
        'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
        { data: `package:${pkg}` }
      );
    } catch (e) {
      await Linking.openSettings();
    }
  },

  /**
   * Opens the Android 14+ settings screen to allow/disallow Full Screen Intents.
   */
  async openFullScreenIntentSettings() {
    if (Platform.OS !== 'android') return;
    const pkg = AndroidPermissionHelper.getPackageName();
    try {
      await IntentLauncher.startActivityAsync(
        'android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT',
        { data: `package:${pkg}` }
      );
    } catch (_e) {
      await Linking.openSettings();
    }
  },

  /**
   * Opens Notification settings for the app.
   */
  async openNotificationSettings() {
    if (Platform.OS === 'android') {
      const pkg = AndroidPermissionHelper.getPackageName();
      try {
        await IntentLauncher.startActivityAsync('android.settings.APP_NOTIFICATION_SETTINGS', {
          extra: { 'android.provider.extra.APP_PACKAGE': pkg },
        });
      } catch (_e) {
        await Linking.openSettings();
      }
    } else {
      await Linking.openSettings();
    }
  }
};
