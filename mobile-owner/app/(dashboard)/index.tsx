// QR Vault — Dashboard Screen (Tab: Dashboard)
// Ports tab-dashboard from owner.html + renderRings/updateStats from app.js
// Integrated with an "Incoming Call" overlay for real-time visitor alerts.

import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Modal,
  Animated,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { useSharedDashboard } from './_layout';
import { Ring } from '../../hooks/useOwnerDashboard';
import { useI18n } from '../../hooks/useI18n';
import { RingCard } from '../../components/RingCard';
import { StatCard } from '../../components/StatCard';
import { showToast } from '../../components/Toast';
import { Colors, Radii, Spacing, Typography } from '../../constants/theme';

const FILTER_OPTIONS = ['all', 'waiting', 'responded'] as const;
type FilterOption = typeof FILTER_OPTIONS[number];

export default function DashboardScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const dashboard = useSharedDashboard();
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  
  // Call Overlay State
  const [incomingRing, setIncomingRing] = useState<Ring | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Custom Reply Modal State
  const [replyModalVisible, setReplyModalVisible] = useState(false);
  const [replyRingId, setReplyRingId] = useState<string | null>(null);
  const [customReplyText, setCustomReplyText] = useState('');

  // Load dashboard on mount
  useEffect(() => {
    if (user?.id) {
      dashboard.loadDashboard(user.id).catch((err) => {
        showToast(err.message || t('error_generic'), 'error');
      });
    }
  }, [user?.id]);

  // Setup realtime with Call Overlay trigger
  useEffect(() => {
    if (dashboard.currentHouseId) {
      dashboard.setupRealtimeSubscription(dashboard.currentHouseId, (ring) => {
        // Trigger the "Incoming Call" UI
        setIncomingRing(ring);
        dashboard.playNotificationSound(); // This will play the chime
      });
    }
    return () => dashboard.teardownRealtime();
  }, [dashboard.currentHouseId]);

  // Pulse animation for the Call Screen
  useEffect(() => {
    if (incomingRing) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [incomingRing]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await dashboard.loadRings();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const onLoadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      await dashboard.loadMoreRings(dashboard.rings);
    } finally {
      setLoadingMore(false);
    }
  }, [dashboard.rings, loadingMore]);

  const handleDismissCall = () => {
    setIncomingRing(null);
  };

  const handleAcceptCall = (ring: Ring) => {
    setIncomingRing(null);
    // Scroll to the ring or just show toast
    showToast(`Opening request from ${ring.door_location}`, 'success');
  };

  const stats = dashboard.computeStats(dashboard.rings);
  const filteredRings = dashboard.getFilteredRings(dashboard.rings);
  const uniqueDoors = dashboard.getUniqueDoors(dashboard.rings);

  const handleSendReply = async (ringId: string, message: string) => {
    const result = await dashboard.sendReply(ringId, message);
    if (result.success) {
      showToast(t('signal_dispatched'), 'success');
      setReplyModalVisible(false);
    } else {
      showToast(result.error || t('error_occurred'), 'error');
    }
  };

  const handleOpenCustomReply = (id: string) => {
    setReplyRingId(id);
    setCustomReplyText('');
    setReplyModalVisible(true);
  };

  const renderRing = ({ item }: { item: Ring }) => (
    <RingCard
      ring={item}
      onAck={(id) => handleSendReply(id, t('acknowledged'))}
      onComing={(id) => handleSendReply(id, t('coming'))}
      onCustomReply={(id) => handleOpenCustomReply(id)}
      onDelete={async (id) => {
        await dashboard.deleteRing(id);
        showToast(t('deleted'), 'success');
      }}
      onDecrypt={dashboard.decryptMessage}
      ackLabel={t('ack')}
      comingLabel={t('coming')}
      replyLabel={t('secure_reply')}
      deleteLabel={t('delete')}
      signalInbound={t('signal_inbound')}
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      {/* House switcher (Owner only) */}
      {dashboard.houses.length > 1 && (
        <View style={styles.houseSwitcher}>
          {dashboard.houses.map((h) => (
            <TouchableOpacity
              key={h.id}
              style={[styles.houseBtn, dashboard.currentHouseId === h.id && styles.houseBtnActive]}
              onPress={() => dashboard.changeHouse(h.id)}
            >
              <Text style={[styles.houseBtnText, dashboard.currentHouseId === h.id && styles.houseBtnTextActive]}>{h.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        data={filteredRings}
        keyExtractor={(item) => item.id}
        renderItem={renderRing}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.accent]} tintColor={Colors.accent} />
        }
        ListHeaderComponent={
          <>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}><StatCard value={dashboard.rings.filter(r => !r.owner_reply).length} label="Missed" icon="phone-missed" /></View>
              <View style={styles.statItem}><StatCard value={dashboard.rings.filter(r => !!r.owner_reply).length} label="Answered" icon="check-circle-outline" /></View>
              <View style={styles.statItem}><StatCard value={uniqueDoors.length} label="No. of Doors" icon="door-open" /></View>
              <View style={styles.statItem}><StatCard value={dashboard.doorPoints.filter(dp => !dp.is_active).length} label="Paused" icon="pause-circle-outline" /></View>
            </View>



            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('activity_log')}</Text>
              <TouchableOpacity onPress={() => { dashboard.markAllRead(); showToast('Marked all as read', 'success'); }}>
                <Text style={styles.sectionAction}>{t('mark_all_read')}</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.searchInput}
              value={dashboard.searchQuery}
              onChangeText={dashboard.setSearchQuery}
              placeholder={t('search_rings')}
              placeholderTextColor={Colors.textMuted}
            />

            <View style={styles.filterRow}>
              {FILTER_OPTIONS.map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterPill, dashboard.currentFilter === f && styles.filterPillActive]}
                  onPress={() => dashboard.setCurrentFilter(f)}
                >
                  <Text style={[styles.filterPillText, dashboard.currentFilter === f && styles.filterPillTextActive]}>{t(f)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {uniqueDoors.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.doorFilterRow}>
                <TouchableOpacity
                  style={[styles.filterPill, dashboard.currentDoorFilter === 'all' && styles.filterPillActive]}
                  onPress={() => dashboard.setCurrentDoorFilter('all')}
                >
                  <Text style={[styles.filterPillText, dashboard.currentDoorFilter === 'all' && styles.filterPillTextActive]}>All Doors</Text>
                </TouchableOpacity>
                {uniqueDoors.map((door) => (
                  <TouchableOpacity
                    key={door}
                    style={[styles.filterPill, dashboard.currentDoorFilter === door && styles.filterPillActive]}
                    onPress={() => dashboard.setCurrentDoorFilter(door)}
                  >
                    <Text style={[styles.filterPillText, dashboard.currentDoorFilter === door && styles.filterPillTextActive]}>{door}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </>
        }
        ListFooterComponent={
          filteredRings.length >= 10 ? (
            <TouchableOpacity style={styles.loadMoreBtn} onPress={onLoadMore} disabled={loadingMore}>
              <Text style={styles.loadMoreText}>{loadingMore ? t('loading') : t('next')}</Text>
            </TouchableOpacity>
          ) : null
        }
      />

      {/* Incoming Call Overlay */}
      <Modal visible={!!incomingRing} transparent animationType="fade">
        <View style={styles.callOverlay}>
          <SafeAreaView style={styles.callContent}>
            <View style={styles.callHeader}>
              <Animated.View style={[styles.callIconContainer, { transform: [{ scale: pulseAnim }] }]}>
                <MaterialCommunityIcons name="bell-ring" size={80} color={Colors.accent} />
              </Animated.View>
              <Text style={styles.callStatus}>INCOMING VISIT</Text>
              <Text style={styles.callLocation}>{incomingRing?.door_location}</Text>
              {incomingRing?.guest_message && (
                <View style={styles.messageBubble}>
                  <Text style={styles.messageText}>"{incomingRing.guest_message}"</Text>
                </View>
              )}
            </View>

            <View style={styles.callFooter}>
              <TouchableOpacity style={[styles.callBtn, styles.declineBtn]} onPress={handleDismissCall}>
                <View style={styles.btnIconBg}>
                  <MaterialCommunityIcons name="phone-hangup" size={32} color={Colors.textInverse} />
                </View>
                <Text style={styles.btnLabel}>IGNORE</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.callBtn, styles.acceptBtn]} onPress={() => handleAcceptCall(incomingRing!)}>
                <View style={[styles.btnIconBg, { backgroundColor: Colors.accent }]}>
                  <MaterialCommunityIcons name="phone-check" size={32} color={Colors.textInverse} />
                </View>
                <Text style={styles.btnLabel}>VIEW</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Custom Reply Modal */}
      <Modal visible={replyModalVisible} transparent animationType="fade" onRequestClose={() => setReplyModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Secure Reply</Text>
              <TouchableOpacity onPress={() => setReplyModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
            
            <View style={{ width: '100%', marginBottom: Spacing.xl }}>
              <Text style={styles.formLabel}>CUSTOM MESSAGE</Text>
              <TextInput
                style={[styles.modalInput, { width: '100%', height: 100, textAlignVertical: 'top' }]}
                value={customReplyText}
                onChangeText={setCustomReplyText}
                placeholder="Type your reply here..."
                placeholderTextColor={Colors.textMuted}
                multiline
              />
            </View>

            <TouchableOpacity 
              style={[styles.primaryBtn, { width: '100%' }]} 
              onPress={() => {
                if (replyRingId) handleSendReply(replyRingId, customReplyText);
              }}
            >
              <Text style={styles.primaryBtnText}>Send Reply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bgObsidian },
  listContent: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  houseSwitcher: { flexDirection: 'row', padding: Spacing.sm, gap: 8, backgroundColor: Colors.bgElevated, borderBottomWidth: 1, borderBottomColor: Colors.glassBorder },
  houseBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: Radii.full, backgroundColor: Colors.glass, borderWidth: 1, borderColor: Colors.glassBorder },
  houseBtnActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  houseBtnText: { fontFamily: Typography.bodySemiBold, fontSize: 12, color: Colors.textMuted },
  houseBtnTextActive: { color: Colors.accent },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: Spacing.md },
  statItem: { width: '48%', marginBottom: Spacing.sm },


  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: Spacing.sm },
  sectionTitle: { fontFamily: Typography.headingBold, fontSize: Typography.sizeLg, color: Colors.accent },
  sectionAction: { fontFamily: Typography.bodySemiBold, fontSize: 12, color: Colors.textMuted },
  searchInput: { backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: Colors.glassBorder, borderRadius: Radii.md, padding: 12, color: Colors.textPrimary, marginBottom: 12 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  doorFilterRow: { marginBottom: 12 },
  filterPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radii.full, backgroundColor: Colors.glass, borderWidth: 1, borderColor: Colors.glassBorder, marginRight: 8 },
  filterPillActive: { backgroundColor: Colors.accent },
  filterPillText: { fontFamily: Typography.bodySemiBold, fontSize: 12, color: Colors.textMuted, textTransform: 'capitalize' },
  filterPillTextActive: { color: Colors.textInverse },
  loadMoreBtn: { padding: 16, alignItems: 'center', backgroundColor: Colors.glass, borderRadius: Radii.md, marginTop: 16 },
  loadMoreText: { fontFamily: Typography.headingBold, color: Colors.textSecondary },
  emptyText: { textAlign: 'center', color: Colors.textMuted, padding: 40 },
  
  // Modal & Input Shared Config (Inherited mostly from Doors screen aesthetics)
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  modalContent: { backgroundColor: Colors.bgElevated, borderRadius: Radii.xl, padding: Spacing.xl, width: '100%', borderWidth: 1, borderColor: Colors.glassBorder },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: Spacing.lg },
  modalTitle: { fontFamily: Typography.headingBold, fontSize: Typography.sizeLg, color: Colors.accent },
  formLabel: { fontFamily: Typography.headingBold, fontSize: 10, color: Colors.textMuted, letterSpacing: 1, marginBottom: 8 },
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
  primaryBtn: { backgroundColor: Colors.accent, borderRadius: Radii.lg, paddingVertical: Spacing.md, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  primaryBtnText: { fontFamily: Typography.headingBold, fontSize: 14, color: Colors.textInverse },

  // Call Overlay styles
  callOverlay: { flex: 1, backgroundColor: Colors.bgObsidian },
  callContent: { flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingVertical: 60 },
  callHeader: { alignItems: 'center', width: '100%', paddingHorizontal: 30 },
  callIconContainer: { marginBottom: 30, backgroundColor: Colors.glass, padding: 30, borderRadius: 100, borderWidth: 1, borderColor: Colors.accent },
  callStatus: { fontFamily: Typography.headingBold, fontSize: 16, color: Colors.textMuted, letterSpacing: 4, marginBottom: 10 },
  callLocation: { fontFamily: Typography.headingBold, fontSize: 32, color: Colors.textPrimary, textAlign: 'center' },
  messageBubble: { marginTop: 30, padding: 20, backgroundColor: Colors.bgElevated, borderRadius: Radii.lg, borderWidth: 1, borderColor: Colors.glassBorder },
  messageText: { fontFamily: Typography.body, fontSize: 18, fontStyle: 'italic', color: Colors.textSecondary, textAlign: 'center' },
  callFooter: { flexDirection: 'row', gap: 60, alignItems: 'center' },
  callBtn: { alignItems: 'center' },
  declineBtn: {},
  acceptBtn: {},
  btnIconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    elevation: 8,
    ...Platform.select({
      web: {
        boxShadow: '0 6px 14px rgba(0, 0, 0, 0.3)',
      },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
    }),
  },
  btnLabel: { fontFamily: Typography.headingBold, fontSize: 12, color: Colors.textSecondary, letterSpacing: 1 },
});
