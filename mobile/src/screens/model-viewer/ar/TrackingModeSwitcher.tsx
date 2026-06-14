// Inline AR tracking-mode switcher — a compact segmented control shown live
// inside the AR view. Replaces the old blocking "Choose Tracking Mode" screen:
// the inspector loads the assembly straight into AR and switches anchoring
// strategy (World / Plane / Image) on the fly to compare stability for QA.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { TrackingMode, TRACKING_MODE_INFO } from './types';

const MODES: TrackingMode[] = ['world', 'plane', 'image'];

const ACCENT: Record<TrackingMode, string> = {
  world: '#64748b',
  plane: '#3b82f6',
  image: '#10b981',
};

const SHORT: Record<TrackingMode, string> = {
  world: 'World',
  plane: 'Plane',
  image: 'Image',
};

interface Props {
  value: TrackingMode;
  onChange: (mode: TrackingMode) => void;
}

export default function TrackingModeSwitcher({ value, onChange }: Props) {
  const info = TRACKING_MODE_INFO[value];
  return (
    <View style={styles.wrap}>
      <View style={styles.segment}>
        {MODES.map((mode) => {
          const active = mode === value;
          return (
            <TouchableOpacity
              key={mode}
              style={[
                styles.seg,
                active && { backgroundColor: ACCENT[mode] },
              ]}
              onPress={() => onChange(mode)}
              activeOpacity={0.8}
            >
              <Text style={[styles.segText, active && styles.segTextActive]}>
                {SHORT[mode]}
              </Text>
              <Text
                style={[styles.segAccuracy, active && styles.segAccuracyActive]}
              >
                {TRACKING_MODE_INFO[mode].accuracy}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.hint} numberOfLines={1}>
        {info.subtitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(13, 17, 23, 0.9)',
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  seg: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 76,
  },
  segText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
  },
  segTextActive: {
    color: '#ffffff',
  },
  segAccuracy: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 1,
  },
  segAccuracyActive: {
    color: 'rgba(255,255,255,0.85)',
  },
  hint: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    maxWidth: 320,
    textAlign: 'center',
    backgroundColor: 'rgba(13, 17, 23, 0.7)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
