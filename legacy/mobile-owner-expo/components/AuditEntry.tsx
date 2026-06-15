// QR Vault — Audit Entry Component

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Radii, Spacing, Typography } from '../constants/theme';
import type { AuditEntry as AuditEntryType } from '../hooks/useOwnerDashboard';

interface AuditEntryProps {
  entry: AuditEntryType;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function AuditEntry({ entry }: AuditEntryProps) {
  return (
    <View style={styles.entry}>
      <Text style={styles.action}>{entry.action}</Text>
      <View style={styles.meta}>
        <Text style={styles.table}>on {entry.table_name || 'unknown'}</Text>
        <Text style={styles.time}>{formatDate(entry.created_at)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  entry: {
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  action: {
    fontFamily: Typography.bodySemiBold,
    fontSize: Typography.sizeMd,
    color: Colors.accent,
    marginBottom: 4,
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  table: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeXs,
    color: Colors.textMuted,
  },
  time: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeXs,
    color: Colors.textMuted,
  },
});
