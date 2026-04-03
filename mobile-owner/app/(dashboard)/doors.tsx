// QR Vault — Door Management Screen
// Unified hub for Door Point creation, QR generation, and Collaborative Sharing

import React, { useEffect, useState, useRef } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import ViewShot, { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

import { useAuth, PASSPHRASE_KEY } from '../../hooks/useAuth';
import { useSharedDashboard } from './_layout';
import { DoorPoint, DoorPointMember } from '../../hooks/useOwnerDashboard';
import { useI18n } from '../../hooks/useI18n';
import { showToast } from '../../components/Toast';
import { SafeSecureStore } from '../../lib/safeStorage';
import { Colors, Radii, Spacing, Typography } from '../../constants/theme';

const GUEST_BASE_URL = 'https://fun-code-q.github.io/Doorbell/';

export default function DoorsScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const dashboard = useSharedDashboard();

  const [doorName, setDoorName] = useState('');
  const [doorDesc, setDoorDesc] = useState('');
  
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [memberModalVisible, setMemberModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [selectedDoor, setSelectedDoor] = useState<DoorPoint | null>(null);
  
  // Member logic state
  const [inviteUsername, setInviteUsername] = useState('');
  const [isManagingMembers, setIsManagingMembers] = useState(false);
  const [editDoorName, setEditDoorName] = useState('');
  const [editDoorDesc, setEditDoorDesc] = useState('');
  const [hasPassphrase, setHasPassphrase] = useState(true);
  
  const qrRef = useRef<ViewShot>(null);

  useEffect(() => {
    SafeSecureStore.getItemAsync(PASSPHRASE_KEY).then(val => setHasPassphrase(!!val));
  }, []);

  useEffect(() => {
    if (dashboard.currentHouseId) {
      dashboard.loadDoorPoints(dashboard.currentHouseId);
    }
  }, [dashboard.currentHouseId]);

  const handleAddDoor = async () => {
    if (!hasPassphrase) {
      showToast('Please create an encryption passphrase in Settings first', 'warning');
      return;
    }
    if (!doorName.trim()) {
      showToast('Enter a door name', 'warning');
      return;
    }
    try {
      await dashboard.addDoorPoint(doorName.trim(), doorDesc.trim());
      showToast(t('saved'), 'success');
      setDoorName('');
      setDoorDesc('');
    } catch (err) {
      showToast((err as Error).message || t('error_occurred'), 'error');
    }
  };

  const handleOpenQR = (dp: DoorPoint) => {
    setSelectedDoor(dp);
    setQrModalVisible(true);
  };

  const handleSaveQR = async () => {
    try {
      if (!qrRef.current) throw new Error('Ref missing');

      const uri = await captureRef(qrRef.current, {
        format: 'png',
        quality: 1.0,
      });

      if (!uri) throw new Error('Capture failed');

      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status === 'granted') {
        await MediaLibrary.saveToLibraryAsync(uri);
        showToast('QR Code saved to Gallery!', 'success');
      } else {
        // Fallback to Sharing if permission is restricted
        await Sharing.shareAsync(uri);
      }
    } catch (err) {
      console.error('QR Save Error:', err);
      showToast('Save failed—please try again.', 'error');
    }
  };

  const handleOpenMembers = async (dp: DoorPoint) => {
    setSelectedDoor(dp);
    setMemberModalVisible(true);
    setIsManagingMembers(true);
    try {
      await dashboard.loadDoorMembers(dp.id);
    } finally {
      setIsManagingMembers(false);
    }
  };

  const handleInvite = async () => {
    if (!selectedDoor || !inviteUsername.trim()) return;
    try {
      await dashboard.addDoorMember(selectedDoor.id, inviteUsername.trim());
      showToast('Member invited!', 'success');
      setInviteUsername('');
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedDoor) return;
    Alert.alert('Remove Member', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          await dashboard.removeDoorMember(selectedDoor.id, userId);
          showToast('Member removed', 'success');
        } catch (err) {
          showToast('Failed to remove member', 'error');
        }
      }}
    ]);
  };

  const handleOpenEdit = (dp: DoorPoint) => {
    setSelectedDoor(dp);
    setEditDoorName(dp.name);
    setEditDoorDesc(dp.description || '');
    setEditModalVisible(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedDoor || !editDoorName.trim()) return;
    try {
      await dashboard.updateDoorPoint(selectedDoor.id, editDoorName.trim(), editDoorDesc.trim());
      showToast('Location updated', 'success');
      setEditModalVisible(false);
    } catch (err) {
      showToast((err as Error).message || 'Failed to rename', 'error');
    }
  };

  const showInstructions = (dp: DoorPoint) => {
    setSelectedDoor(dp);
    setInfoModalVisible(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.fixedAddSection}>
          <View style={[styles.card, styles.addCard]}>
            <Text style={styles.cardTitle}>Add New Location</Text>
            <View style={styles.inputGroup}>
              <MaterialCommunityIcons name="pencil-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={doorName}
                onChangeText={setDoorName}
                placeholder="Location Name (e.g. Front Door)"
                placeholderTextColor={Colors.textMuted}
                maxLength={13}
              />
            </View>
            <View style={styles.inputGroup}>
              <MaterialCommunityIcons name="text-box-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={doorDesc}
                onChangeText={setDoorDesc}
                placeholder="Instructions (optional)"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleAddDoor}>
              <Text style={styles.primaryBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={styles.locationsScroll} contentContainerStyle={styles.locationsContainer} showsVerticalScrollIndicator={false}>
          {dashboard.doorPoints.map((dp) => (
            <View key={dp.id} style={[styles.doorCard, !dp.is_active && styles.doorCardInactive]}>
              <View style={styles.doorHeader}>
                <View style={styles.doorInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[styles.doorName, { marginBottom: 0 }, !dp.is_active && styles.textStrikethrough]}>{dp.name}</Text>
                    {dp.description ? (
                      <TouchableOpacity onPress={() => showInstructions(dp)} style={{ marginLeft: 6, padding: 2, paddingBottom: 0 }}>
                        <MaterialCommunityIcons name="information" size={16} color={Colors.accent} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
                <View style={styles.doorControls}>
                  <TouchableOpacity onPress={() => dashboard.setDoorPointActive(dp.id, !dp.is_active)} style={styles.toggleBtn}>
                    <MaterialCommunityIcons 
                      name={dp.is_active ? "power" : "power-off"} 
                      size={24} 
                      color={dp.is_active ? Colors.accent : Colors.textMuted} 
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => handleOpenQR(dp)}>
                  <MaterialCommunityIcons name="qrcode" size={20} color={Colors.textPrimary} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionBtn} onPress={() => handleOpenMembers(dp)}>
                  <MaterialCommunityIcons name="account-group" size={20} color={Colors.textPrimary} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionBtn} onPress={() => handleOpenEdit(dp)}>
                  <MaterialCommunityIcons name="pencil" size={20} color={Colors.textSecondary} />
                </TouchableOpacity>

                <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => dashboard.deleteDoorPoint(dp.id)}>
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color={Colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {dashboard.doorPoints.length === 0 ? (
            <Text style={styles.emptyText}>No locations yet. Add your first location above.</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* QR Code Modal */}
      <Modal visible={qrModalVisible} transparent animationType="fade" onRequestClose={() => setQrModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedDoor?.name}</Text>
              <TouchableOpacity onPress={() => setQrModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.qrContainer}>
              <ViewShot ref={qrRef} options={{ format: 'png', quality: 1.0 }}>
                <View style={styles.qrBg} collapsable={false}>
                  <QRCode
                    value={`${GUEST_BASE_URL}?t=${selectedDoor?.qr_token}`}
                    size={220}
                    color={Colors.bgObsidian}
                    backgroundColor="#FFFFFF"
                  />
                  <Text style={styles.qrBrand}>QR VAULT</Text>
                </View>
              </ViewShot>
            </View>

            <TouchableOpacity style={[styles.primaryBtn, { width: '100%' }]} onPress={handleSaveQR}>
              <MaterialCommunityIcons name="download" size={20} color={Colors.textInverse} style={{marginRight: 8}} />
              <Text style={styles.primaryBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Edit Door Name Modal */}
      <Modal visible={editModalVisible} transparent animationType="fade" onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Location</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
            
            <View style={{ width: '100%', marginBottom: Spacing.md }}>
              <Text style={styles.formLabel}>LOCATION NAME</Text>
              <TextInput
                style={[styles.modalInput, { width: '100%' }]}
                value={editDoorName}
                onChangeText={setEditDoorName}
                placeholder="Name"
                placeholderTextColor={Colors.textMuted}
                maxLength={13}
              />
            </View>

            <View style={{ width: '100%', marginBottom: Spacing.xl }}>
              <Text style={styles.formLabel}>INSTRUCTIONS (OPTIONAL)</Text>
              <TextInput
                style={[styles.modalInput, { width: '100%', height: 100, textAlignVertical: 'top' }]}
                value={editDoorDesc}
                onChangeText={setEditDoorDesc}
                placeholder="Enter instructions for guests..."
                placeholderTextColor={Colors.textMuted}
                multiline
              />
            </View>

            <TouchableOpacity style={[styles.primaryBtn, { width: '100%' }]} onPress={handleSaveEdit}>
              <Text style={styles.primaryBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Info Modal */}
      <Modal visible={infoModalVisible} transparent animationType="fade" onRequestClose={() => setInfoModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MaterialCommunityIcons name="information" size={24} color={Colors.accent} style={{ marginRight: 8 }} />
                <Text style={styles.modalTitle}>Instructions</Text>
              </View>
              <TouchableOpacity onPress={() => setInfoModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ width: '100%', maxHeight: 300, marginBottom: Spacing.lg }}>
              <Text style={{ color: Colors.textSecondary, fontFamily: Typography.body, fontSize: 16, lineHeight: 24 }}>
                {selectedDoor?.description || 'No instructions provided.'}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Members Management Modal */}
      <Modal visible={memberModalVisible} transparent animationType="slide" onRequestClose={() => setMemberModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentLarge}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Channel Members</Text>
              <TouchableOpacity onPress={() => setMemberModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.inviteForm}>
              <TextInput
                style={[styles.modalInput, { flex: 1 }]}
                value={inviteUsername}
                onChangeText={setInviteUsername}
                placeholder="Invite by Username"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.inviteBtn} onPress={handleInvite}>
                <MaterialCommunityIcons name="plus" size={24} color={Colors.textInverse} />
              </TouchableOpacity>
            </View>

            <Text style={styles.listHeader}>Current Members</Text>
            {isManagingMembers ? (
              <ActivityIndicator color={Colors.accent} size="small" style={{marginTop: 20}} />
            ) : (
              <ScrollView style={styles.memberList}>
                {(dashboard.doorPointMembers[selectedDoor?.id || ''] || []).map((m: DoorPointMember) => (
                  <View key={m.id} style={styles.memberItem}>
                    <View style={styles.memberInfo}>
                      <MaterialCommunityIcons name="account-circle" size={32} color={Colors.accent} />
                      <Text style={styles.memberName}>{m.profile?.username || 'User'}</Text>
                    </View>
                    <View style={styles.memberActions}>
                      {m.user_id !== user?.id ? (
                        <TouchableOpacity onPress={() => handleRemoveMember(m.user_id)}>
                          <MaterialCommunityIcons name="account-remove" size={24} color={Colors.error} />
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity 
                          onPress={() => dashboard.muteDoorMember(selectedDoor!.id, !m.is_muted)}
                          style={[styles.muteBtn, m.is_muted && styles.muteBtnActive]}
                        >
                          <MaterialCommunityIcons 
                            name={m.is_muted ? "bell-off" : "bell"} 
                            size={20} 
                            color={m.is_muted ? Colors.textMuted : Colors.accent} 
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
            
            <Text style={styles.footerNote}>Members will receive notifications for this door simultaneously.</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgObsidian },
  flex: { flex: 1 },
  fixedAddSection: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.bgObsidian,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassBorder,
  },
  locationsScroll: { flex: 1 },
  locationsContainer: { padding: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
  sectionTitle: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeXl,
    fontWeight: '800',
    color: Colors.accent,
    marginBottom: Spacing.md,
  },
  card: {
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.xl,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  addCard: { marginBottom: 0 },
  cardTitle: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeMd,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  inputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  inputIcon: { marginRight: 8 },
  input: {
    flex: 1,
    paddingVertical: Spacing.sm,
    color: Colors.textPrimary,
    fontFamily: Typography.body,
    fontSize: Typography.sizeMd,
  },
  primaryBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeSm,
    color: Colors.textInverse,
    textTransform: 'uppercase',
  },
  doorCard: {
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  doorCardInactive: { opacity: 0.5 },
  doorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
  doorInfo: { flex: 1 },
  doorName: { 
    fontFamily: Typography.headingBold, 
    fontSize: Typography.sizeMd, 
    color: Colors.textPrimary, 
    marginBottom: 2 
  },
  textStrikethrough: { textDecorationLine: 'line-through' },
  doorDesc: { fontFamily: Typography.body, fontSize: Typography.sizeSm, color: Colors.textMuted },
  doorControls: { flexDirection: 'row', alignItems: 'center' },
  toggleBtn: { padding: 4 },
  actionRow: { 
    flexDirection: 'row', 
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.glass,
    paddingVertical: 10,
    borderRadius: Radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 6,
  },
  deleteBtn: { flex: 0.4 },
  actionBtnText: { 
    fontFamily: Typography.bodySemiBold, 
    fontSize: 12, 
    color: Colors.textPrimary 
  },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.85)', 
    justifyContent: 'center', 
    alignItems: 'center',
    padding: Spacing.xl
  },
  modalContent: { 
    backgroundColor: Colors.bgElevated, 
    borderRadius: Radii.xl, 
    padding: Spacing.xl, 
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  modalContentLarge: { 
    backgroundColor: Colors.bgElevated, 
    borderRadius: Radii.xl, 
    padding: Spacing.xl, 
    width: '100%',
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  modalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    width: '100%',
    marginBottom: Spacing.lg
  },
  modalTitle: { 
    fontFamily: Typography.headingBold, 
    fontSize: Typography.sizeLg, 
    color: Colors.accent 
  },
  formLabel: {
    fontFamily: Typography.headingBold,
    fontSize: 10,
    color: Colors.textMuted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  qrContainer: { 
    padding: 20, 
    backgroundColor: '#FFFFFF', 
    borderRadius: Radii.lg, 
    marginBottom: Spacing.lg 
  },
  qrBg: { alignItems: 'center', backgroundColor: '#FFFFFF', padding: 10 },
  qrBrand: { 
    marginTop: 10, 
    fontFamily: Typography.headingBold, 
    fontSize: 14, 
    color: Colors.bgObsidian,
    letterSpacing: 2
  },
  inviteForm: { flexDirection: 'row', gap: 8, marginBottom: Spacing.lg },
  modalInput: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    minHeight: 52,
    color: '#FFFFFF',
    fontFamily: Typography.body,
    fontSize: 16,
  },
  inviteBtn: {
    backgroundColor: Colors.accent,
    width: 48,
    height: 48,
    borderRadius: Radii.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listHeader: { fontFamily: Typography.bodySemiBold, color: Colors.textMuted, marginBottom: 8 },
  memberList: { marginBottom: Spacing.md },
  memberItem: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    backgroundColor: Colors.glass,
    padding: Spacing.sm,
    borderRadius: Radii.md,
    marginBottom: 8,
  },
  memberInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberName: { fontFamily: Typography.bodySemiBold, color: Colors.textPrimary },
  memberActions: { flexDirection: 'row', gap: 10 },
  muteBtn: { padding: 4 },
  muteBtnActive: { opacity: 0.5 },
  footerNote: { 
    fontFamily: Typography.body, 
    fontSize: 12, 
    color: Colors.textMuted, 
    textAlign: 'center',
    marginTop: 10
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textMuted,
    fontFamily: Typography.body,
    fontSize: Typography.sizeSm,
    paddingVertical: Spacing.lg,
  },
});
