import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../theme/colors';

/**
 * Pure-RN circular progress (no SVG dependency): two clipped semicircle
 * halves rotated by the progress angle — the classic CSS ring technique.
 */
export function ProgressRing({
  percent,
  size = 84,
  thickness = 8,
  color = Colors.warning,
  trackColor = Colors.border,
  label,
  lightText = false,
}: {
  percent: number;
  size?: number;
  thickness?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  /** White percent text for dark backgrounds. */
  lightText?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, percent));
  const firstDeg = Math.min(pct, 50) * 3.6; // right half: 0..180°
  const secondDeg = Math.max(pct - 50, 0) * 3.6; // left half: 0..180°
  const half = size / 2;

  const ringColor = pct >= 100 ? Colors.success : color;

  return (
    <View style={{ width: size, height: size }}>
      {/* track */}
      <View style={[styles.abs, { width: size, height: size, borderRadius: half, borderWidth: thickness, borderColor: trackColor }]} />

      {/* right half (0–50%): clip to right side, rotate a half-ring into view */}
      <View style={[styles.abs, styles.clip, { width: half, height: size, left: half }]}>
        <View
          style={{
            position: 'absolute',
            left: -half,
            width: size,
            height: size,
            borderRadius: half,
            borderWidth: thickness,
            borderColor: 'transparent',
            borderTopColor: ringColor,
            borderRightColor: ringColor,
            transform: [{ rotate: `${-135 + firstDeg}deg` }],
          }}
        />
      </View>

      {/* left half (50–100%) */}
      {secondDeg > 0 && (
        <View style={[styles.abs, styles.clip, { width: half, height: size, left: 0 }]}>
          <View
            style={{
              position: 'absolute',
              left: 0,
              width: size,
              height: size,
              borderRadius: half,
              borderWidth: thickness,
              borderColor: 'transparent',
              borderTopColor: ringColor,
              borderRightColor: ringColor,
              transform: [{ rotate: `${45 + secondDeg}deg` }],
            }}
          />
        </View>
      )}

      <View style={[styles.abs, styles.center, { width: size, height: size }]}>
        <Text style={[styles.pct, { fontSize: size * 0.24 }, lightText && styles.pctLight]}>{Math.round(pct)}%</Text>
        {label ? <Text style={[styles.lbl, lightText && styles.lblLight]} numberOfLines={1}>{label}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute', top: 0 },
  clip: { overflow: 'hidden' },
  center: { left: 0, alignItems: 'center', justifyContent: 'center' },
  pct: { fontWeight: '800', color: Colors.text },
  pctLight: { color: Colors.white },
  lbl: { fontSize: 10, color: Colors.textSecondary, maxWidth: '80%' },
  lblLight: { color: 'rgba(255,255,255,0.7)' },
});
