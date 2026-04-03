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
      } catch {}
    })();

    return () => {
      active = false;
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
