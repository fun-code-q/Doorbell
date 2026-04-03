// QR Vault - Root Layout
// Sets up fonts, safe area, toast manager, and auth-based routing
// Integrates Full-Screen Incoming Call Handling (CallKeep + TaskManager)

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
import { SUPABASE_CONFIG_MISSING } from '../lib/supabase';

const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND_NOTIFICATION_TASK';

// Suppress Expo Go development environment warnings
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  'Expo AV has been deprecated',
  'Expo Go can no longer provide full access to the media library',
  'NamelessError',
  'expo-notifications',
]);

// 1. Register background task for processing doorbell rings
if (!TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
    if (error) {
      console.error('Core: Background notification task error:', error);
      return;
    }
    if (data) {
      const { notification } = data as any;
      const ringData = notification?.data || {};
      
      // If it's a ring call type, trigger the system Call UI
      if (ringData.type === 'ring_call' || ringData.ring_id) {
         RNCallKeep.displayIncomingCall(
           ringData.ring_id || 'unknown',
           'QR Doorbell',
           ringData.door_location || 'Guest at Door',
           'number',
           false
         );
      }
    }
  });
}

function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        router.replace('/(dashboard)');
      } else {
        router.replace('/(auth)/login');
      }
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
            Set EAS environment values for EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then rebuild.
          </Text>
        </View>
      </SafeAreaProvider>
    );
  }

  useEffect(() => {
    const isUnsupported = (Constants.appOwnership === 'expo' && Platform.OS === 'android') || Platform.OS === 'web';
    if (isUnsupported) return;

    // 2. Initialize CallKeep
    const callKeepOptions = {
      ios: { appName: 'QR Vault' },
      android: {
        alertTitle: 'Permissions Required',
        alertDescription: 'QR Vault needs phone permissions to show incoming rings.',
        cancelButton: 'Cancel',
        okButton: 'OK',
        selfManaged: true,
        additionalPermissions: [],
      }
    };

    try {
      RNCallKeep.setup(callKeepOptions).then(accepted => {
        if (accepted) {
          RNCallKeep.setAvailable(true);
        }
      }).catch(() => {});

      // Configure Android Notification Channel for High Priority Rings
      if (Platform.OS === 'android') {
        Notifications.setNotificationChannelAsync('rings', {
          name: 'Incoming Rings',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
          lightColor: '#f59e0b',
          showBadge: true,
        });
      }
    } catch (e) {
      console.warn('Notification/CallKeep setup failed:', e);
    }

    // 3. Register Background Notification Task
    Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => {});

    // 4. Notification Response Handler (Foreground/Background tap)
    const handleNotificationPayload = (data: any) => {
      if (!data) return;
      const ringId = typeof data.ring_id === 'string' ? data.ring_id : null;
      const doorLocation = typeof data.door_location === 'string' ? data.door_location : 'Guest at Door';
      const houseId = typeof data.house_id === 'string' ? data.house_id : null;
      const url = typeof data.url === 'string' ? data.url : null;
      const type = data.type;

      // Priority: Trigger Full-Screen Incoming Ring UI
      if (type === 'ring_call' || ringId) {
        router.push({
          pathname: '/incoming-ring',
          params: { ring_id: ringId || '', door_location: doorLocation, house_id: houseId || undefined }
        });
        return;
      }

      // Fallback: Handle deep links
      if (url && url.startsWith('qrvault://')) {
        try {
          const parsed = new URL(url);
          const deepRingId = parsed.searchParams.get('ring_id');
          if (deepRingId) {
            router.push({
              pathname: '/(dashboard)',
              params: { incoming_ring_id: deepRingId } as any
            });
            return;
          }
        } catch {}
      }

      router.push('/(dashboard)');
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationPayload(response.notification.request.content.data);
    });

    // 5. Configuration for Foreground/Background Ring UI
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const data = notification.request.content.data;
        if (data.type === 'ring_call') {
          return {
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldPlaySound: true,
            shouldShowList: true,
            shouldSetBadge: true,
            priority: Notifications.AndroidNotificationPriority.MAX,
          };
        }
        return {
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldPlaySound: true,
          shouldShowList: true,
          shouldSetBadge: true,
        };
      },
    });

    // Handle cold start from notification
    (async () => {
      try {
        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        if (lastResponse) {
          handleNotificationPayload(lastResponse.notification.request.content.data);
        }
      } catch {}
    })();

    return () => {
      responseSub.remove();
    };
  }, []);

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
