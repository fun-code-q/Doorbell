import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Radii, Spacing, Typography } from '../constants/theme';

interface StatCardProps {
  value: string | number;
  label: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
}

export function StatCard({ value, label, icon }: StatCardProps) {
  return (
    <View style={styles.card}>
      {icon && <MaterialCommunityIcons name={icon} size={20} color={Colors.accent} style={{ marginBottom: 4 }} />}
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 140,
    marginBottom: Spacing.sm,
  },
  value: {
    fontFamily: Typography.headingBold,
    fontSize: Typography.sizeXxl,
    fontWeight: '800',
    color: Colors.accent,
    lineHeight: 36,
  },
  label: {
    fontFamily: Typography.body,
    fontSize: Typography.sizeXs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
});
