// Ported verbatim from glb-viewer (pure RN, no native deps).
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MeasurementState } from './types';
import { ModelDimensions, formatMeters } from './dimensionExtractor';

interface MeasurementPanelProps {
  measurements: MeasurementState;
  dimensions: ModelDimensions | null;
  onChange: (patch: Partial<MeasurementState>) => void;
  onClearRulers: () => void;
}

export default function MeasurementPanel({
  measurements,
  dimensions,
  onChange,
  onClearRulers,
}: MeasurementPanelProps) {
  const toggle = (label: string, active: boolean, onPress: () => void) => (
    <TouchableOpacity
      style={[styles.toggle, active && styles.toggleActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Measurements</Text>

      {dimensions && (
        <Text style={styles.summary}>
          {formatMeters(dimensions.overall.size[0])} × {formatMeters(dimensions.overall.size[1])} × {formatMeters(dimensions.overall.size[2])}
          {'  ·  '}
          {dimensions.parts.length} parts
        </Text>
      )}
      {!dimensions && (
        <Text style={styles.summary}>Analyzing GLB…</Text>
      )}

      {toggle(
        `Overall dims ${measurements.showOverall ? 'ON' : 'OFF'}`,
        measurements.showOverall,
        () => onChange({ showOverall: !measurements.showOverall })
      )}

      {toggle(
        `Per-part dims ${measurements.showParts ? 'ON' : 'OFF'}`,
        measurements.showParts,
        () => onChange({ showParts: !measurements.showParts })
      )}

      {toggle(
        `Model ruler ${measurements.modelRulerActive ? 'ON' : 'OFF'}`,
        measurements.modelRulerActive,
        () =>
          onChange({
            modelRulerActive: !measurements.modelRulerActive,
            realRulerActive: false,
          })
      )}

      {toggle(
        `Real-world ruler ${measurements.realRulerActive ? 'ON' : 'OFF'}`,
        measurements.realRulerActive,
        () =>
          onChange({
            realRulerActive: !measurements.realRulerActive,
            modelRulerActive: false,
          })
      )}

      {(measurements.modelRulerPoints.length > 0 ||
        measurements.realRulerPoints.length > 0) && (
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={onClearRulers}
          activeOpacity={0.7}
        >
          <Text style={styles.clearBtnText}>Clear ruler points</Text>
        </TouchableOpacity>
      )}

      {(measurements.modelRulerActive || measurements.realRulerActive) && (
        <Text style={styles.hint}>
          Tap two points to measure.{'\n'}
          Tap a third to reset and start again.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 8,
    top: 140,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    borderRadius: 16,
    padding: 12,
    width: 210,
    gap: 6,
  },
  title: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  summary: {
    color: '#8892b0',
    fontSize: 11,
    marginBottom: 6,
    lineHeight: 14,
  },
  toggle: {
    backgroundColor: 'rgba(51, 65, 85, 0.8)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  toggleActive: {
    backgroundColor: 'rgba(14, 165, 233, 0.9)',
  },
  toggleText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  toggleTextActive: {
    color: '#ffffff',
  },
  clearBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 4,
  },
  clearBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  hint: {
    color: '#facc15',
    fontSize: 11,
    marginTop: 6,
    lineHeight: 14,
    textAlign: 'center',
  },
});
