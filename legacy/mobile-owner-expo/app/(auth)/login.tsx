// QR Vault — Login Screen
// Ports the auth-overlay HTML from owner.html
// Sign In / Sign Up toggle with the same Supabase auth calls via useAuth

import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../hooks/useI18n';
import { showToast } from '../../components/Toast';
import { Colors, Radii, Spacing, Typography } from '../../constants/theme';

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const { t } = useI18n();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      showToast('Please enter email and password', 'warning');
      return;
    }
    setLoading(true);
    try {
      if (isSignUp) {
        const result = await signUp(email, password);
        if (result.success) {
          showToast('Vault created! Please check your email, then sign in.', 'success');
          setIsSignUp(false);
        } else {
          showToast(result.error || 'Sign up failed', 'error');
        }
      } else {
        const result = await signIn(email, password);
        if (result.success) {
          showToast('Welcome back!', 'success');
          router.replace('/(dashboard)');
        } else {
          showToast(result.error || 'Invalid credentials', 'error');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Decorative background glow */}
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={styles.logoRow}>
            <Text style={styles.logoIcon}>⬡</Text>
            <Text style={styles.logo}>QR VAULT</Text>
          </View>
          <Text style={styles.logoSub}>Owner Dashboard</Text>

          {/* Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {isSignUp ? t('owner_signup_subtitle') : t('owner_signin_subtitle')}
            </Text>

            {/* Email */}
            <Text style={styles.label}>{t('email')}</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={Colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              returnKeyType="next"
            />

            {/* Password */}
            <Text style={styles.label}>{t('password')}</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />

            {/* Submit */}
            <TouchableOpacity
              style={[styles.btnPrimary, loading && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color={Colors.textInverse} />
              ) : (
                <Text style={styles.btnPrimaryText}>
                  {isSignUp ? t('sign_up') : t('sign_in')}
                </Text>
              )}
            </TouchableOpacity>

            {/* Toggle sign in / sign up */}
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => setIsSignUp((prev) => !prev)}
            >
              <Text style={styles.toggleText}>
                {isSignUp ? t('have_account') : t('no_account')}{' '}
                <Text style={styles.toggleLink}>
                  {isSignUp ? t('sign_in') : t('create_one')}
                </Text>
              </Text>
            </TouchableOpacity>
          </View>

          {/* Version */}
          <Text style={styles.version}>QR Vault v1.0</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgObsidian },
  flex: { flex: 1 },
  glowTop: {
    position: 'absolute',
    top: -100,
    right: -80,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: Colors.accentGlow,
    opacity: 0.35,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -120,
    left: -60,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: Colors.accentGlow,
    opacity: 0.2,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginBottom: 4,
  },
  logoIcon: { fontSize: 28, color: Colors.accent },
  logo: {
    fontFamily: Typography.headingBold,
    fontSize: 36,
    fontWeight: '800',
    color: Colors.accent,
    letterSpacing: -2,
  },
  logoSub: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeSm,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.xxl,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.xl,
    padding: Spacing.xl,
  },
  cardTitle: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeSm,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  label: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeSm,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  input: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    color: Colors.textPrimary,
    fontFamily: Typography.body,
    fontSize: Typography.sizeMd,
    marginBottom: Spacing.sm,
  },
  btnPrimary: {
    backgroundColor: Colors.accent,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.md,
    ...Platform.select({
      web: {
        boxShadow: `0 6px 12px ${Colors.accent}66`,
      },
      default: {
        shadowColor: Colors.accent,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
    }),
    elevation: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnPrimaryText: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeMd,
    color: Colors.textInverse,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  toggleRow: {
    marginTop: Spacing.lg,
    alignItems: 'center',
  },
  toggleText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeSm,
    color: Colors.textMuted,
  },
  toggleLink: {
    color: Colors.accent,
    fontFamily: Typography.bodySemiBold,
  },
  version: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeXs,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.xl,
    opacity: 0.5,
  },
});
