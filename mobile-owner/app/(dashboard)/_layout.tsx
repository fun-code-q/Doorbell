import React, { createContext, useContext } from 'react';
import { Platform, TouchableOpacity, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Typography, Radii, Spacing } from '../../constants/theme';
import { useAuth } from '../../hooks/useAuth';
import { useOwnerDashboard } from '../../hooks/useOwnerDashboard';

export const DashboardContext = createContext<ReturnType<typeof useOwnerDashboard> | null>(null);

export function useSharedDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('Missing DashboardContext');
  return ctx;
}

export default function DashboardLayout() {
  const { signOut } = useAuth();
  const dashboard = useOwnerDashboard();

  return (
    <DashboardContext.Provider value={dashboard}>
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: Colors.bgObsidian,
          borderBottomColor: Colors.glassBorder,
          borderBottomWidth: 1,
        },
        headerTitleStyle: {
          fontFamily: Typography.headingBold,
          fontSize: 18,
          color: Colors.accent,
        },
        headerRight: () => (
          <TouchableOpacity 
            onPress={() => signOut()}
            style={{ 
              marginRight: Spacing.md,
              padding: 6,
              borderRadius: Radii.sm,
              backgroundColor: Colors.glass,
              borderWidth: 1,
              borderColor: Colors.glassBorder,
            }}
          >
            <MaterialCommunityIcons name="logout" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        ),
        tabBarStyle: {
          backgroundColor: Colors.bgElevated,
          borderTopColor: Colors.glassBorder,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : 68,
          paddingBottom: Platform.OS === 'ios' ? 24 : 12,
          paddingTop: 10,
          elevation: 24,
          ...Platform.select({
            web: {
              boxShadow: '0 -4px 12px rgba(0,0,0,0.4)',
            },
            default: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.4,
              shadowRadius: 12,
            }
          }),
        },
        tabBarBackground: () => <View style={{ flex: 1, backgroundColor: Colors.bgElevated }} />,
        sceneStyle: { backgroundColor: Colors.bgObsidian },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: {
          fontFamily: Typography.bodySemiBold,
          fontSize: 10,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ 
          title: 'Dashboard', 
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="view-dashboard" size={size} color={color} />
          ) 
        }}
      />
      <Tabs.Screen
        name="doors"
        options={{ 
          title: 'Door Management', 
          tabBarLabel: 'Door',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="door-closed" size={size} color={color} />
          ) 
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ 
          title: 'Settings', 
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="cog" size={size} color={color} />
          ) 
        }}
      />
      <Tabs.Screen
        name="audit"
        options={{ 
          title: 'Audit', 
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="history" size={size} color={color} />
          ) 
        }}
      />
      <Tabs.Screen
        name="qr-factory"
        options={{ 
          href: null,
        }}
      />
    </Tabs>
    </DashboardContext.Provider>
  );
}
