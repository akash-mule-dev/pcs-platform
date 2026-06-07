// Ported verbatim from glb-viewer (pure RN, no native deps).
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Vec3 } from './types';

const TILT_STEP = 2;

interface TiltControlsProps {
  rotation: Vec3;
  locked: boolean;
  onRotationChange: (rotation: Vec3) => void;
}

export default function TiltControls({
  rotation,
  locked,
  onRotationChange,
}: TiltControlsProps) {
  const nudge = (axis: 0 | 1 | 2, delta: number) => {
    if (locked) return;
    const next: Vec3 = [rotation[0], rotation[1], rotation[2]];
    next[axis] += delta;
    onRotationChange(next);
  };

  const renderBtn = (label: string, onPress: () => void) => (
    <TouchableOpacity
      style={[styles.button, locked && styles.disabled]}
      onPress={onPress}
      disabled={locked}
      activeOpacity={0.7}
    >
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.dpad}>
      <View style={styles.row}>
        <View style={styles.spacer} />
        {renderBtn('↑', () => nudge(0, -TILT_STEP))}
        <View style={styles.spacer} />
      </View>
      <View style={styles.row}>
        {renderBtn('←', () => nudge(2, TILT_STEP))}
        <View style={styles.spacer} />
        {renderBtn('→', () => nudge(2, -TILT_STEP))}
      </View>
      <View style={styles.row}>
        <View style={styles.spacer} />
        {renderBtn('↓', () => nudge(0, TILT_STEP))}
        <View style={styles.spacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dpad: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  spacer: {
    width: 56,
    height: 56,
  },
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.15)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 4,
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    color: '#0f172a',
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 28,
  },
});
