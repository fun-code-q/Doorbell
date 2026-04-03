// QR Vault - Root Layout
// Sets up fonts, safe area, toast manager, and auth-based routing

import React, { useEffect } from 'react';
import { View, LogBox, Platform } from 'react-native';
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
import { useAuth } from '../hooks/useAuth';
import { ToastManager } from '../components/Toast';
import { Colors } from '../constants/theme';

// Suppress Expo Go development environment warnings and errors related to missing native modules
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  'Expo AV has been deprecated',
  'Expo Go can no longer provide full access to the media library',
  'NamelessError',
  'expo-notifications',
]);

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
    // Expo Go on Android (SDK 53+) does not support remote push APIs.
    // Avoid importing expo-notifications there to prevent runtime errors.
    const isUnsupported = (Constants.appOwnership === 'expo' && Platform.OS === 'android') || Platform.OS === 'web';
    if (isUnsupported) return;

    let active = true;
    const openFromNotification = (response: any) => {
      const data = response?.notification?.request?.content?.data || {};
      const ringId = typeof data.ring_id === 'string' ? data.ring_id : null;
      const houseId = typeof data.house_id === 'string' ? data.house_id : null;
      const url = typeof data.url === 'string' ? data.url : null;

      if (ringId) {
        router.push({
          pathname: '/(dashboard)',
          params: {
            incoming_ring_id: ringId,
            house_id: houseId || undefined,
          } as any,
        });
        return;
      }

      if (url && url.startsWith('qrvault://')) {
        try {
          const parsed = new URL(url);
          const deepRingId = parsed.searchParams.get('ring_id');
          const deepHouseId = parsed.searchParams.get('house_id');
          if (deepRingId) {
            router.push({
              pathname: '/(dashboard)',
              params: {
                incoming_ring_id: deepRingId,
                house_id: deepHouseId || undefined,
              } as any,
            });
            return;
          }
        } catch {}
      }

      router.push('/(dashboard)');
    };

    let responseSub: { remove: () => void } | null = null;

    (async () => {
      try {
        const Notifications = await import('expo-notifications');
        if (!active) return;
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
          }),
        });

        responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
          openFromNotification(response);
        });

        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        if (lastResponse) {
          openFromNotification(lastResponse);
        }
      } catch {}
    })();

    return () => {
      active = false;
      responseSub?.remove();
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
