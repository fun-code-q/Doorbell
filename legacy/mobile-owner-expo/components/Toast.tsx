// QR Vault — Toast Notification Component
// Replaces Utils.showToast() — a global in-app notification overlay

import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radii, Spacing, Typography } from '../constants/theme';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  message: string;
  type?: ToastType;
  visible: boolean;
  onDismiss: () => void;
}

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
};

const COLORS: Record<ToastType, string> = {
  success: Colors.success,
  error: Colors.error,
  warning: Colors.warning,
  info: Colors.info,
};

export function Toast({ message, type = 'info', visible, onDismiss }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  const useNativeDriver = Platform.OS !== 'web';
  
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver }),
        Animated.spring(translateY, { toValue: 0, tension: 80, friction: 10, useNativeDriver }),
      ]).start();
      const timer = setTimeout(() => onDismiss(), 4000);
      return () => clearTimeout(timer);
    } else {
      Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver }).start();
    }
  }, [visible]);

  if (!visible) return null;

  const color = COLORS[type];

  return (
    <Animated.View style={[styles.container, { opacity, transform: [{ translateY }] }]}>
      <View style={[styles.indicator, { backgroundColor: color }]} />
      <View style={[styles.iconWrap, { backgroundColor: color + '22' }]}>
        <Text style={[styles.icon, { color }]}>{ICONS[type]}</Text>
      </View>
      <Text style={styles.message} numberOfLines={3}>{message}</Text>
      <TouchableOpacity style={styles.close} onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.closeText}>×</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// -----------------------------------------------------------------------
// Toast Manager — a simple global singleton for programmatic toasts
// -----------------------------------------------------------------------
type ToastCallback = (message: string, type: ToastType) => void;
let _toastCallback: ToastCallback | null = null;

export function registerToast(cb: ToastCallback) {
  _toastCallback = cb;
}

export function showToast(message: string, type: ToastType = 'info') {
  if (_toastCallback) _toastCallback(message, type);
}

// -----------------------------------------------------------------------
// ToastManager — mount this once in root layout
// -----------------------------------------------------------------------
export function ToastManager() {
  const [state, setState] = React.useState<{ message: string; type: ToastType; visible: boolean }>({
    message: '',
    type: 'info',
    visible: false,
  });

  useEffect(() => {
    registerToast((message, type) => {
      setState({ message, type, visible: true });
    });
  }, []);

  return (
    <Toast
      message={state.message}
      type={state.type}
      visible={state.visible}
      onDismiss={() => setState((s) => ({ ...s, visible: false }))}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: Spacing.md,
    right: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    overflow: 'hidden',
    zIndex: 9999,
    elevation: 20,
    ...Platform.select({
      web: {
        boxShadow: '0 8px 16px rgba(0,0,0,0.5)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.5,
        shadowRadius: 16,
      }
    })
  },
  indicator: {
    width: 4,
    alignSelf: 'stretch',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: Spacing.sm,
  },
  icon: {
    fontSize: 15,
    fontWeight: '700',
  },
  message: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: Typography.sizeSm,
    fontFamily: Typography.body,
    paddingVertical: Spacing.md,
    paddingRight: Spacing.xs,
  },
  close: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  closeText: {
    color: Colors.textMuted,
    fontSize: 22,
    lineHeight: 24,
  },
});
