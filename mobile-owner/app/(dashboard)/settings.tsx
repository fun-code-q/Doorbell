// QR Vault — Settings Screen
// Ports tab-settings from owner.html

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { SafeSecureStore } from '../../lib/safeStorage';
import { useAuth, PASSPHRASE_KEY } from '../../hooks/useAuth';
import { useSharedDashboard } from './_layout';
import { useI18n } from '../../hooks/useI18n';
import { showToast } from '../../components/Toast';
import { Colors, Radii, Spacing, Typography } from '../../constants/theme';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { t, lang, setLang } = useI18n();
  const dashboard = useSharedDashboard();

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [autoLogout, setAutoLogout] = useState('15');
  const [saving, setSaving] = useState(false);

  // Passphrase states
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [hasPassphrase, setHasPassphrase] = useState(false);
  const [showPassphraseForm, setShowPassphraseForm] = useState(false);

  useEffect(() => {
    if (user?.id && dashboard.currentHouseId) {
      dashboard.loadSettings(user.id, dashboard.currentHouseId).then((s) => {
        if (s) {
          setSoundEnabled(s.sound_enabled);
          setVibrationEnabled(s.vibration_enabled);
          setPushEnabled(s.push_enabled);
        }
      });
    }
  }, [user?.id, dashboard.currentHouseId]);

  useEffect(() => {
    SafeSecureStore.getItemAsync(PASSPHRASE_KEY).then((val) => {
      setHasPassphrase(!!val);
    });
  }, []);

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      // 1. Save general settings
      await dashboard.saveSettings(user.id, {
        sound_enabled: soundEnabled,
        vibration_enabled: vibrationEnabled,
        push_enabled: pushEnabled,
        language: lang,
        auto_logout_minutes: 0,
      });

      // 2. Save passphrase if provided (non-empty)
      if (passphrase.trim()) {
        await SafeSecureStore.setItemAsync(PASSPHRASE_KEY, passphrase.trim());
        setHasPassphrase(true);
        setPassphrase('');
        setShowPassphraseForm(false);
      }

      showToast(t('saved'), 'success');
    } catch (err) {
      showToast((err as Error).message || t('error_occurred'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* Notification Settings */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Notifications</Text>

          <SettingRow label={t('notification_sound')} value={soundEnabled} onChange={setSoundEnabled} />
          <SettingRow label={t('vibration')} value={vibrationEnabled} onChange={setVibrationEnabled} />
          <SettingRow label={t('push_enabled')} value={pushEnabled} onChange={setPushEnabled} />
        </View>

        {/* Encryption passphrase */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔐 Encryption Passphrase</Text>
          <Text style={styles.cardSub}>{t('passphrase_hint')}</Text>
          {hasPassphrase && !showPassphraseForm ? (
            <View>
              <Text style={styles.passphraseSet}>✓ Passphrase is set</Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => setShowPassphraseForm(true)}
              >
                <Text style={styles.secondaryBtnText}>Change Passphrase</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <TextInput
                style={styles.input}
                value={passphrase}
                onChangeText={setPassphrase}
                placeholder={t('passphrase_placeholder')}
                placeholderTextColor={Colors.textMuted}
                secureTextEntry
              />
            </View>
          )}
        </View>

        {/* Save settings */}
        <TouchableOpacity
          style={[styles.primaryBtn, saving && styles.btnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={Colors.textInverse} />
          ) : (
            <Text style={styles.primaryBtnText}>{t('save')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: Colors.glassBorder, true: Colors.accent }}
        thumbColor={Colors.textPrimary}
      />
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassBorder,
  },
  label: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeMd,
    color: Colors.textPrimary,
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgObsidian },
  container: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  sectionTitle: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeXl,
    fontWeight: '800',
    color: Colors.accent,
    letterSpacing: -1,
    marginBottom: Spacing.md,
  },
  card: {
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.xl,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  cardTitle: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeMd,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  cardSub: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeSm,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  settingLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeMd,
    color: Colors.textPrimary,
  },
  numInput: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.textPrimary,
    fontFamily: Typography.body,
    fontSize: Typography.sizeMd,
    width: 80,
    textAlign: 'center',
  },
  input: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.textPrimary,
    fontFamily: Typography.body,
    fontSize: Typography.sizeMd,
    marginBottom: Spacing.sm,
  },
  langRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  langPill: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    alignItems: 'center',
  },
  langPillActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  langPillText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeSm,
    color: Colors.textMuted,
  },
  langPillTextActive: { color: Colors.accent },
  passphraseSet: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeMd,
    color: Colors.success,
    marginBottom: Spacing.sm,
  },
  primaryBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginBottom: Spacing.md,
    elevation: 6,
    ...Platform.select({
      web: { boxShadow: `0 4px 8px ${Colors.accent}4D` },
      default: {
        shadowColor: Colors.accent,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
    }),
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeSm,
    color: Colors.textInverse,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  secondaryBtn: {
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  secondaryBtnText: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeSm,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  signOutBtn: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
    borderRadius: Radii.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  signOutText: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeSm,
    color: Colors.error,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
