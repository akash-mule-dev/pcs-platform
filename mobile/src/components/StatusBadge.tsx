import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusColors, Colors } from '../theme/colors';

interface StatusBadgeProps {
  status: string;
  small?: boolean;
}

function toLabel(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ status, small }: StatusBadgeProps) {
  const color = StatusColors[status] || Colors.medium;
  return (
    <View style={[styles.chip, { borderColor: color }, small && styles.chipSmall]}>
      <Text style={[styles.label, { color }, small && styles.labelSmall]}>
        {toLabel(status)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  chipSmall: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  labelSmall: {
    fontSize: 11,
  },
});
