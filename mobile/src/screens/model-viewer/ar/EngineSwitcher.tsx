// Engine selector — Viro (3 tracking modes, all devices) vs LiDAR (native
// RealityKit modes, iPad + LiDAR only). Rendered by ARViewScreen ONLY when both
// engines are available, so there's no dead UI on unsupported devices.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Engine } from './types';

const ENGINES: { key: Engine; label: string }[] = [
  { key: 'viro', label: 'Standard' },
  { key: 'realitykit', label: '🛰 LiDAR' },
];

interface Props {
  value: Engine;
  onChange: (engine: Engine) => void;
  style?: StyleProp<ViewStyle>;
}

export default function EngineSwitcher({ value, onChange, style }: Props) {
  return (
    <View style={[styles.wrap, style]} pointerEvents="box-none">
      <View style={styles.segment}>
        {ENGINES.map((e) => {
          const active = e.key === value;
          return (
            <TouchableOpacity
              key={e.key}
              style={[styles.seg, active && styles.segActive]}
              onPress={() => onChange(e.key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.segText, active && styles.segTextActive]}>{e.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  segment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(13, 17, 23, 0.92)',
    borderRadius: 14,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  seg: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', minWidth: 84 },
  segActive: { backgroundColor: 'rgba(14, 165, 233, 0.95)' },
  segText: { color: '#cbd5e1', fontSize: 13, fontWeight: '700' },
  segTextActive: { color: '#ffffff' },
});
