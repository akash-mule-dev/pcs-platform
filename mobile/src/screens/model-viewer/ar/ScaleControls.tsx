// Ported verbatim from glb-viewer (pure RN, no native deps).
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Vec3 } from './types';

const SCALE_FACTOR = 1.03; // 3% bigger / smaller per tap — always a relative step
const MIN_SCALE = 0.01;
const MAX_SCALE = 5;

interface ScaleControlsProps {
  scale: Vec3;
  locked: boolean;
  onScaleChange: (scale: Vec3) => void;
}

export default function ScaleControls({
  scale,
  locked,
  onScaleChange,
}: ScaleControlsProps) {
  const nudge = (multiplier: number) => {
    if (locked) return;
    const factor = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale[0] * multiplier));
    onScaleChange([factor, factor, factor]);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, locked && styles.disabled]}
        onPress={() => nudge(SCALE_FACTOR)}
        disabled={locked}
        activeOpacity={0.7}
      >
        <Text style={styles.label}>+</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, locked && styles.disabled]}
        onPress={() => nudge(1 / SCALE_FACTOR)}
        disabled={locked}
        activeOpacity={0.7}
      >
        <Text style={styles.label}>−</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
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
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 30,
  },
});
