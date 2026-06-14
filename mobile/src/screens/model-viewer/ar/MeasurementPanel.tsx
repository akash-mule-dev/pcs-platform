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
  /** Log the current model↔real deviation as a QA measurement (out-of-tolerance auto-fails). */
  onLogDeviation?: () => void;
}

function dist(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export default function MeasurementPanel({
  measurements,
  dimensions,
  onChange,
  onClearRulers,
  onLogDeviation,
}: MeasurementPanelProps) {
  const deviationMeters =
    measurements.deviationModelPoint && measurements.deviationRealPoint
      ? dist(measurements.deviationModelPoint, measurements.deviationRealPoint)
      : null;
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
            deviationActive: false,
          })
      )}

      {toggle(
        `Real-world ruler ${measurements.realRulerActive ? 'ON' : 'OFF'}`,
        measurements.realRulerActive,
        () =>
          onChange({
            realRulerActive: !measurements.realRulerActive,
            modelRulerActive: false,
            deviationActive: false,
          })
      )}

      {toggle(
        `Deviation probe ${measurements.deviationActive ? 'ON' : 'OFF'}`,
        measurements.deviationActive,
        () =>
          onChange({
            deviationActive: !measurements.deviationActive,
            modelRulerActive: false,
            realRulerActive: false,
            deviationModelPoint: null,
            deviationRealPoint: null,
          })
      )}

      {(measurements.modelRulerPoints.length > 0 ||
        measurements.realRulerPoints.length > 0 ||
        measurements.deviationModelPoint != null) && (
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={onClearRulers}
          activeOpacity={0.7}
        >
          <Text style={styles.clearBtnText}>Clear points</Text>
        </TouchableOpacity>
      )}

      {(measurements.modelRulerActive || measurements.realRulerActive) && (
        <Text style={styles.hint}>
          Tap two points to measure.{'\n'}
          Tap a third to reset and start again.
        </Text>
      )}

      {measurements.deviationActive && (
        <Text style={styles.hint}>
          Tap the model, then the matching point on the real part.
        </Text>
      )}

      {deviationMeters != null && (
        <View style={styles.deviationBox}>
          <Text style={styles.deviationValue}>Δ {formatMeters(deviationMeters)}</Text>
          {onLogDeviation && (
            <TouchableOpacity style={styles.logDeviationBtn} onPress={onLogDeviation} activeOpacity={0.7}>
              <Text style={styles.logDeviationText}>Log as QA</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 8,
    top: 200,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    borderRadius: 16,
    padding: 12,
    width: 210,
    gap: 6,
    // Above the corner buttons (25) and the viz rail (18) so its toggles are
    // never painted over while open.
    zIndex: 28,
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
  deviationBox: {
    marginTop: 8,
    backgroundColor: 'rgba(34, 211, 238, 0.15)',
    borderRadius: 10,
    padding: 8,
    alignItems: 'center',
    gap: 6,
  },
  deviationValue: {
    color: '#22d3ee',
    fontSize: 15,
    fontWeight: '800',
  },
  logDeviationBtn: {
    backgroundColor: 'rgba(34, 211, 238, 0.9)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  logDeviationText: {
    color: '#062b30',
    fontSize: 12,
    fontWeight: '800',
  },
});
