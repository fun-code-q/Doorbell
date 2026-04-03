// QR Vault — Door Point Item Component

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radii, Spacing, Typography } from '../constants/theme';
import type { DoorPoint } from '../hooks/useOwnerDashboard';

interface DoorPointItemProps {
  dp: DoorPoint;
  onQR: (dp: DoorPoint) => void;
  onCopyLink: (dp: DoorPoint) => void;
  onToggleActive: (dp: DoorPoint) => void;
  onEdit: (dp: DoorPoint) => void;
  onDelete: (dp: DoorPoint) => void;
  editLabel: string;
  deleteLabel: string;
}

export function DoorPointItem({
  dp,
  onQR,
  onCopyLink,
  onToggleActive,
  onEdit,
  onDelete,
  editLabel,
  deleteLabel,
}: DoorPointItemProps) {
  return (
    <View style={styles.item}>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{dp.name}</Text>
          <View style={[styles.statusBadge, dp.is_active ? styles.activeBadge : styles.inactiveBadge]}>
            <Text style={[styles.statusText, dp.is_active ? styles.activeText : styles.inactiveText]}>
              {dp.is_active ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>
        {dp.description ? (
          <Text style={styles.description} numberOfLines={1}>{dp.description}</Text>
        ) : null}
        <Text style={styles.token}>Token: {dp.qr_token.slice(0, 12)}···</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onQR(dp)}>
          <Text style={styles.actionBtnText}>QR</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onCopyLink(dp)}>
          <Text style={styles.actionBtnText}>Link</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, dp.is_active ? styles.dangerBtn : styles.primaryBtn]}
          onPress={() => onToggleActive(dp)}
        >
          <Text style={[styles.actionBtnText, dp.is_active ? styles.dangerText : styles.primaryText]}>
            {dp.is_active ? 'Deactivate' : 'Activate'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onEdit(dp)}>
          <Text style={styles.actionBtnText}>{editLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.dangerBtn]} onPress={() => onDelete(dp)}>
          <Text style={[styles.actionBtnText, styles.dangerText]}>{deleteLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  info: {
    marginBottom: Spacing.sm,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 4,
  },
  name: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeLg,
    color: Colors.textPrimary,
  },
  statusBadge: {
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
  },
  activeBadge: { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.3)' },
  inactiveBadge: { backgroundColor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)' },
  statusText: { fontSize: Typography.sizeXs, fontFamily: Typography.bodySemiBold },
  activeText: { color: Colors.success },
  inactiveText: { color: Colors.error },
  description: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeSm,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  token: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeXs,
    color: Colors.textMuted,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  actionBtn: {
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  primaryBtn: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  dangerBtn: { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' },
  actionBtnText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeXs,
    color: Colors.textSecondary,
  },
  primaryText: { color: Colors.accent },
  dangerText: { color: Colors.error },
});
