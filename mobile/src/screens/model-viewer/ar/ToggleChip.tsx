// A compact ON/OFF pill used for the LiDAR quick toggles (Occlusion, Edges).
// icon + label on the left, ON/OFF state on the right; bright when on.
import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  icon: string;
  label: string;
  on: boolean;
  onPress: () => void;
}

export default function ToggleChip({ icon, label, on, onPress }: Props) {
  return (
    <TouchableOpacity
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.icon, on && styles.textOn]}>{icon}</Text>
      <Text style={[styles.label, on && styles.textOn]}>{label}</Text>
      <Text style={[styles.state, on && styles.textOn]}>{on ? 'ON' : 'OFF'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    minWidth: 150,
    backgroundColor: 'rgba(13, 17, 23, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  chipOn: { backgroundColor: 'rgba(14, 165, 233, 0.95)', borderColor: 'rgba(255,255,255,0.3)' },
  icon: { fontSize: 15 },
  label: { color: '#cbd5e1', fontSize: 13, fontWeight: '700', flex: 1 },
  state: { color: '#8892b0', fontSize: 11, fontWeight: '800' },
  textOn: { color: '#ffffff' },
});
