// QR Vault — QR Factory Screen
// Ports tab-qr-factory from owner.html
// Uses react-native-qrcode-svg instead of canvas, react-native-view-shot for saving PNG

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import ViewShot from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import { useAuth } from '../../hooks/useAuth';
import { useOwnerDashboard } from '../../hooks/useOwnerDashboard';
import { useI18n } from '../../hooks/useI18n';
import { showToast } from '../../components/Toast';
import { Colors, Radii, Spacing, Typography } from '../../constants/theme';
import type { DoorPoint } from '../../hooks/useOwnerDashboard';

// Base URL for your guest web app
const GUEST_BASE_URL = 'https://fun-code-q.github.io/Doorbell/';

export default function QRFactoryScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const dashboard = useOwnerDashboard();

  const [doorName, setDoorName] = useState('');
  const [selectedDoor, setSelectedDoor] = useState<DoorPoint | null>(null);
  const [saving, setSaving] = useState(false);
  const viewShotRef = useRef<ViewShot>(null);

  // Load door points on mount
  React.useEffect(() => {
    if (dashboard.currentHouseId) {
      dashboard.loadDoorPoints(dashboard.currentHouseId);
    }
  }, [dashboard.currentHouseId]);

  const handleGenerate = () => {
    const name = doorName.trim().toLowerCase();
    if (!name) {
      showToast('Enter a door point name', 'warning');
      return;
    }
    const found = dashboard.doorPoints.find(
      (dp) => dp.name.toLowerCase() === name
    );
    if (!found) {
      showToast('Door not found. Add it in the Doors tab first.', 'warning');
      return;
    }
    setSelectedDoor(found);
    showToast(`QR ready for ${found.name}`, 'success');
  };

  const handleSavePNG = async () => {
    if (!viewShotRef.current || !selectedDoor) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow media library access to save QR codes.');
      return;
    }
    setSaving(true);
    try {
      const uri = await (viewShotRef.current as any).capture();
      const asset = await MediaLibrary.createAssetAsync(uri);
      await MediaLibrary.createAlbumAsync('QR Vault', asset, false);
      showToast(`QR saved to your gallery`, 'success');
    } catch (err) {
      showToast('Failed to save QR code', 'error');
    } finally {
      setSaving(false);
    }
  };

  const guestUrl = selectedDoor
    ? dashboard.getGuestUrl(selectedDoor, GUEST_BASE_URL)
    : '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Text style={styles.sectionTitle}>{t('point_factory')}</Text>
        <Text style={styles.sectionSub}>
          Generate QR codes for your door access points
        </Text>

        {/* Input card */}
        <View style={styles.card}>
          <Text style={styles.label}>{t('point_identifier')}</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={doorName}
              onChangeText={setDoorName}
              placeholder={t('point_identifier')}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleGenerate}
            />
            <TouchableOpacity style={styles.generateBtn} onPress={handleGenerate}>
              <Text style={styles.generateBtnText}>{t('generate')}</Text>
            </TouchableOpacity>
          </View>

          {/* Autocomplete suggestions */}
          {dashboard.doorPoints.length > 0 && (
            <View style={styles.suggestions}>
              <Text style={styles.suggestionsLabel}>Available door points:</Text>
              <View style={styles.suggestionPills}>
                {dashboard.doorPoints.map((dp) => (
                  <TouchableOpacity
                    key={dp.id}
                    style={[styles.pill, !dp.is_active && styles.pillInactive]}
                    onPress={() => {
                      setDoorName(dp.name);
                      setSelectedDoor(dp);
                    }}
                  >
                    <Text style={[styles.pillText, !dp.is_active && styles.pillInactiveText]}>
                      {dp.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* QR Output */}
        {selectedDoor && guestUrl ? (
          <View style={styles.qrCard}>
            <Text style={styles.qrLabel}>{selectedDoor.name}</Text>
            <Text style={styles.qrUrl} numberOfLines={2}>{guestUrl}</Text>

            {/* QR Code with ViewShot wrapper for capture */}
            <ViewShot
              ref={viewShotRef}
              options={{ format: 'png', quality: 1 }}
              style={styles.qrWrapper}
            >
              <View style={styles.qrInner}>
                <QRCode
                  value={guestUrl}
                  size={240}
                  color="#000000"
                  backgroundColor="#ffffff"
                  logoBackgroundColor="#ffffff"
                />
              </View>
            </ViewShot>

            <View style={styles.qrActions}>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSavePNG}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={Colors.textInverse} />
                ) : (
                  <Text style={styles.saveBtnText}>📥 {t('archive_png')}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.copyLinkBtn}
                onPress={() => dashboard.copyDoorLink(selectedDoor, GUEST_BASE_URL).then(() =>
                  showToast('Door link copied!', 'success')
                )}
              >
                <Text style={styles.copyLinkText}>🔗 Copy Link</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

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
    marginBottom: 4,
  },
  sectionSub: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeSm,
    color: Colors.textMuted,
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
  label: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeSm,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: { flexDirection: 'row', gap: Spacing.sm },
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
  },
  generateBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    ...Platform.select({
      web: { boxShadow: `0 4px 8px ${Colors.accent}59` },
      default: {
        shadowColor: Colors.accent,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
    }),
  },
  generateBtnText: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeSm,
    color: Colors.textInverse,
    letterSpacing: 1,
  },
  suggestions: { marginTop: Spacing.md },
  suggestionsLabel: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeXs,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  suggestionPills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  pill: {
    backgroundColor: Colors.accentLight,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  pillInactive: {
    backgroundColor: Colors.glass,
    borderColor: Colors.glassBorder,
    opacity: 0.5,
  },
  pillText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeSm,
    color: Colors.accent,
  },
  pillInactiveText: { color: Colors.textMuted },
  qrCard: {
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.xl,
    padding: Spacing.xl,
    alignItems: 'center',
  },
  qrLabel: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeLg,
    fontWeight: '800',
    color: Colors.accent,
    marginBottom: 4,
  },
  qrUrl: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeXs,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  qrWrapper: {
    marginBottom: Spacing.lg,
    borderRadius: Radii.lg,
    overflow: 'hidden',
  },
  qrInner: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: Radii.lg,
  },
  qrActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
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
  saveBtnText: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeSm,
    color: Colors.textInverse,
    letterSpacing: 0.5,
  },
  copyLinkBtn: {
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  copyLinkText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeSm,
    color: Colors.textSecondary,
  },
});
