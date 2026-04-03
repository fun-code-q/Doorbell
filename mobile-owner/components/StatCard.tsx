import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Radii, Spacing, Typography } from '../constants/theme';

interface StatCardProps {
  value: string | number;
  label: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  compact?: boolean;
}

export function StatCard({ value, label, icon, compact = false }: StatCardProps) {
  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={styles.headerRow}>
        {icon && (
          <View style={[styles.iconWrap, compact && styles.iconWrapCompact]}>
            <MaterialCommunityIcons name={icon} size={compact ? 14 : 16} color={Colors.accent} />
          </View>
        )}
        <Text style={[styles.label, compact && styles.labelCompact]} numberOfLines={2}>
          {label}
        </Text>
      </View>
      <Text style={[styles.value, compact && styles.valueCompact]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 110,
    justifyContent: 'space-between',
  },
  cardCompact: {
    minHeight: 94,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  iconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  iconWrapCompact: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  value: {
    fontFamily: Typography.headingBold,
    fontSize: 30,
    fontWeight: '800',
    color: Colors.accent,
    lineHeight: 34,
    marginTop: 4,
  },
  valueCompact: {
    fontSize: 24,
    lineHeight: 28,
  },
  label: {
    flex: 1,
    fontFamily: Typography.bodySemiBold,
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  labelCompact: {
    fontSize: 9,
    letterSpacing: 0.7,
  },
});
