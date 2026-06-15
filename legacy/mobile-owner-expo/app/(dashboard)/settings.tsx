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
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { useSharedDashboard } from './_layout';
import { useI18n } from '../../hooks/useI18n';
import { AndroidPermissionHelper } from '../../lib/androidPermissions';
import { showToast } from '../../components/Toast';
import { Colors, Radii, Spacing, Typography } from '../../constants/theme';

export default function SettingsScreen() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const dashboard = useSharedDashboard();

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

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
        auto_logout_minutes: dashboard.settings?.auto_logout_minutes ?? 15,
      });

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

        {/* Android Troubleshooting (Hidden on iOS) */}
        {Platform.OS === 'android' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Android Notification Troubleshooting</Text>
            <Text style={styles.cardHelper}>
              If rings do not appear while minimized or closed, enable these Android settings:
            </Text>

            <TouchableOpacity 
              style={styles.troubleRow} 
              onPress={() => AndroidPermissionHelper.requestOverlayPermission()}
            >
              <Text style={styles.troubleLabel}>1. Display Over Other Apps</Text>
              <Text style={styles.troubleAction}>CONFIGURE</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.troubleRow} 
              onPress={() => AndroidPermissionHelper.requestIgnoreBatteryOptimizations()}
            >
              <Text style={styles.troubleLabel}>2. Ignore Battery Optimizations</Text>
              <Text style={styles.troubleAction}>UNRESTRICT</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.troubleRow} 
              onPress={() => AndroidPermissionHelper.openNotificationSettings()}
            >
              <Text style={styles.troubleLabel}>3. Notification Channel + Pop On Screen</Text>
              <Text style={styles.troubleAction}>VIEW</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.troubleRow}
              onPress={() => AndroidPermissionHelper.openFullScreenIntentSettings()}
            >
              <Text style={styles.troubleLabel}>4. Full-Screen Rings (Android 14+)</Text>
              <Text style={styles.troubleAction}>ALLOW</Text>
            </TouchableOpacity>
          </View>
        )}

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
  cardHelper: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeSm,
    color: Colors.textMuted,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  troubleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.glassBorder,
  },
  troubleLabel: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeSm,
    color: Colors.textPrimary,
    flex: 1,
  },
  troubleAction: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeXs,
    color: Colors.accent,
    letterSpacing: 0.5,
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

