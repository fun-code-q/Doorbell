// QR Vault - Root Layout
// Sets up auth routing and hardened Android ring notification bootstrap.

import React, { useEffect } from 'react';
import { View, Text, LogBox, Platform, StyleSheet } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import RNCallKeep from 'react-native-callkeep';
import { useAuth } from '../hooks/useAuth';
import { ToastManager } from '../components/Toast';
import { Colors } from '../constants/theme';
import { AndroidPermissionHelper } from '../lib/androidPermissions';
import { SUPABASE_CONFIG_MISSING } from '../lib/supabase';
import { Storage } from '../lib/storage';
import {
  BACKGROUND_NOTIFICATION_TASK,
  DOORBELL_RING_CHANNEL_ID,
  isRingNotificationPayload,
  normalizeRingPayload,
} from '../lib/notifications';
import * as Linking from 'expo-linking';

const BATTERY_OPT_PROMPT_KEY = 'battery_opt_prompt_shown_v2';
const isAndroidExpoGo = Constants.appOwnership === 'expo' && Platform.OS === 'android';
const shouldUseNativeRingStack = Platform.OS !== 'web' && !isAndroidExpoGo;

const callKeepOptions = {
  ios: { appName: 'QR Vault' },
  android: {
    alertTitle: 'Permissions Required',
    alertDescription: 'QR Vault needs phone permissions to show incoming rings.',
    cancelButton: 'Cancel',
    okButton: 'OK',
    selfManaged: true,
    additionalPermissions: [],
  },
};

let callKeepReadyPromise: Promise<void> | null = null;

async function ensureCallKeepReady() {
  if (!shouldUseNativeRingStack) return;
  if (!callKeepReadyPromise) {
    callKeepReadyPromise = RNCallKeep.setup(callKeepOptions)
      .then(() => {
        RNCallKeep.setAvailable(true);
      })
      .catch(() => {});
  }
  await callKeepReadyPromise;
}

async function ensureDoorbellRingChannel() {
  if (Platform.OS !== 'android' || !shouldUseNativeRingStack) return;
  try {
    await Notifications.setNotificationChannelAsync(DOORBELL_RING_CHANNEL_ID, {
      name: 'Doorbell Rings',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 1000, 500, 1000, 500, 1000],
      lightColor: '#f59e0b',
      showBadge: true,
      sound: 'default',
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch {}
}

async function displayIncomingRingViaSystem(payload: unknown) {
  if (Platform.OS !== 'android' || !shouldUseNativeRingStack) return;
  if (!isRingNotificationPayload(payload)) return;

  const { ringId, doorLocation } = normalizeRingPayload(payload);
  if (!ringId) return;

  await ensureCallKeepReady();
  try {
    RNCallKeep.displayIncomingCall(ringId, 'QR Doorbell', doorLocation, 'number', false);
  } catch {}
}

function routeToRingScreen(payload: unknown) {
  if (!isRingNotificationPayload(payload)) return false;
  const { ringId, doorLocation, houseId } = normalizeRingPayload(payload);
  if (!ringId) return false;

  router.replace({
    pathname: '/incoming-ring',
    params: {
      ring_id: ringId,
      door_location: doorLocation,
      ...(houseId ? { house_id: houseId } : {}),
    },
  });
  return true;
}

// Suppress noisy non-actionable dev warnings.
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  'Expo AV has been deprecated',
  'Expo Go can no longer provide full access to the media library',
  'NamelessError',
  'expo-notifications',
]);

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const isRing = isRingNotificationPayload(notification.request.content.data);
      return {
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        priority: isRing
          ? Notifications.AndroidNotificationPriority.MAX
          : Notifications.AndroidNotificationPriority.HIGH,
      };
    },
  });
}

if (!TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
    if (error) {
      console.error('Background notification task error:', error);
      return;
    }

    const payload = (data as { data?: Record<string, unknown> } | undefined)?.data;
    if (!isRingNotificationPayload(payload)) return;

    // 1. Wake the system channel
    await ensureDoorbellRingChannel();
    
    // 2. Proactively bring the app to visible state if it's android
    if (Platform.OS === 'android') {
      try {
        await ensureCallKeepReady();
        
        // 1. Force the app to foreground if it was killed
        const { ringId, doorLocation, houseId } = normalizeRingPayload(payload);
        const url = `qrvault://incoming?ring_id=${ringId}&door_location=${encodeURIComponent(doorLocation)}` + 
                    (houseId ? `&house_id=${houseId}` : '');
        
        await Linking.openURL(url);
        
        // 2. Display the native incoming UI as a secondary anchor
        RNCallKeep.backToForeground();
        await displayIncomingRingViaSystem(payload);
      } catch (e) {
        console.error('Failed to wake foreground from background task:', e);
      }
    }
  });
}

if (shouldUseNativeRingStack) {
  Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => {});
}

function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.replace('/(auth)/login');
      return;
    }

    (async () => {
      try {
        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        const hasPendingRing = routeToRingScreen(
          lastResponse?.notification?.request?.content?.data
        );
        if (!hasPendingRing) {
          router.replace('/(dashboard)');
        }
      } catch {
        router.replace('/(dashboard)');
      }
    })();

    if (Platform.OS === 'android') {
      (async () => {
        const alreadyPrompted = await Storage.get<boolean>('permission_prompt_v3', false);
        if (alreadyPrompted) return;
        await Storage.set('permission_prompt_v3', true);
        
        // Request deep sleeping exclusion
        await AndroidPermissionHelper.requestIgnoreBatteryOptimizations();
        // Request overlay (Display over other apps)
        await AndroidPermissionHelper.requestOverlayPermission();
      })();
    }
  }, [isAuthenticated, isLoading]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(dashboard)" />
      <Stack.Screen name="incoming-ring" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (!shouldUseNativeRingStack || SUPABASE_CONFIG_MISSING) return;

    void ensureDoorbellRingChannel();
    void ensureCallKeepReady();

    const answerCallSub = RNCallKeep.addEventListener('answerCall', ({ callUUID }) => {
      RNCallKeep.backToForeground();
      routeToRingScreen({ ring_id: callUUID, type: 'ring_call' });
    });

    const showIncomingCallUiSub = RNCallKeep.addEventListener(
      'showIncomingCallUi',
      ({ callUUID, name }) => {
        routeToRingScreen({
          ring_id: callUUID,
          door_location: name || 'Guest at Door',
          type: 'ring_call',
        });
      }
    );

    const endCallSub = RNCallKeep.addEventListener('endCall', () => {
      RNCallKeep.endAllCalls();
    });

    const notificationReceivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const payload = notification.request.content.data;
      if (!isRingNotificationPayload(payload)) return;
      void displayIncomingRingViaSystem(payload);
      routeToRingScreen(payload);
    });

    const notificationResponseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const payload = response.notification.request.content.data;
      routeToRingScreen(payload);
    });

    (async () => {
      try {
        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        routeToRingScreen(lastResponse?.notification?.request?.content?.data);
      } catch {}
    })();

    return () => {
      answerCallSub.remove();
      showIncomingCallUiSub.remove();
      endCallSub.remove();
      notificationReceivedSub.remove();
      notificationResponseSub.remove();
    };
  }, []);

  if (SUPABASE_CONFIG_MISSING) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={Colors.bgObsidian} />
        <View style={styles.configErrorScreen}>
          <Text style={styles.configErrorTitle}>Configuration Required</Text>
          <Text style={styles.configErrorBody}>
            Supabase variables are missing in this build.
          </Text>
          <Text style={styles.configErrorBody}>
            Set EAS environment values for EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY,
            then rebuild.
          </Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor={Colors.bgObsidian} />
      <View style={{ flex: 1, backgroundColor: Colors.bgObsidian }}>
        <RootNavigator />
        <ToastManager />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  configErrorScreen: {
    flex: 1,
    backgroundColor: Colors.bgObsidian,
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 12,
  },
  configErrorTitle: {
    color: Colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  configErrorBody: {
    color: Colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
});
