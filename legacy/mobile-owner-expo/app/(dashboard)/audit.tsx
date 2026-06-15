// QR Vault — Audit Log Screen
// Ports tab-audit from owner.html

import React, { useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { useSharedDashboard } from './_layout';
import { useI18n } from '../../hooks/useI18n';
import { AuditEntry } from '../../components/AuditEntry';
import { Colors, Spacing, Typography, Radii } from '../../constants/theme';
import type { AuditEntry as AuditEntryType } from '../../hooks/useOwnerDashboard';
import { TouchableOpacity } from 'react-native';

export default function AuditScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const dashboard = useSharedDashboard();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (dashboard.currentHouseId) {
      dashboard.loadAuditLog(dashboard.currentHouseId);
    }
  }, [dashboard.currentHouseId]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (dashboard.currentHouseId) {
        await dashboard.loadAuditLog(dashboard.currentHouseId);
      }
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={dashboard.auditEntries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[Colors.accent]}
            tintColor={Colors.accent}
            progressBackgroundColor={Colors.bgElevated}
          />
        }

        renderItem={({ item }: { item: AuditEntryType }) => (
          <AuditEntry entry={item} />
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>{t('no_audit_entries')}</Text>
        }
      />
      {dashboard.auditEntries.length > 0 && (
        <View style={styles.fixedFooter}>
          <TouchableOpacity 
            style={styles.clearBtn}
            onPress={() => dashboard.clearAuditLog()}
          >
            <Text style={styles.clearBtnText}>Clear Audits</Text>
          </TouchableOpacity>
        </View>
      )}
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
    marginBottom: Spacing.md,
  },
  emptyText: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeMd,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: Spacing.xxl,
  },
  fixedFooter: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Platform.OS === 'ios' ? Spacing.xl : Spacing.md,
    backgroundColor: Colors.bgObsidian,
    borderTopWidth: 1,
    borderTopColor: Colors.glassBorder,
  },
  clearBtn: {
    backgroundColor: Colors.error + '1A',
    padding: Spacing.md,
    borderRadius: Radii.lg,
    alignItems: 'center',
    borderColor: Colors.error + '33',
    borderWidth: 1,
  },
  clearBtnText: {
    color: Colors.error,
    fontFamily: Typography.headingBold,
  },
});
