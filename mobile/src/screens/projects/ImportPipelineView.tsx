import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { ImportStatusColors } from '../../services/projects.service';
import { PIPELINE_STEPS, stepStates, IMPORT_STATUS_LABELS, PipelineRow } from './import-pipeline';

/** Linear determinate progress bar (0–100). */
export function ProgressBar({ percent, color = Colors.primary }: { percent: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

/** Coloured status pill for an import row. */
export function ImportStatusChip({ status }: { status: string }) {
  const color = ImportStatusColors[status] || Colors.medium;
  return (
    <View style={[styles.chip, { backgroundColor: color }]}>
      <Text style={styles.chipTxt}>{IMPORT_STATUS_LABELS[status] || status}</Text>
    </View>
  );
}

/** The 4-step pipeline stepper (Upload · Extract · Build tree · Convert 3D). */
export function PipelineStepper({ row }: { row: PipelineRow }) {
  const states = stepStates(row);
  return (
    <View style={styles.stepper}>
      {PIPELINE_STEPS.map((step, i) => {
        const state = states[i];
        const dotColor =
          state === 'done' ? Colors.success
          : state === 'current' ? Colors.primary
          : state === 'error' ? Colors.danger
          : Colors.border;
        const icon =
          state === 'done' ? 'checkmark'
          : state === 'error' ? 'close'
          : state === 'current' ? 'ellipse' : undefined;
        return (
          <React.Fragment key={step.key}>
            {i > 0 && (
              <View style={[styles.connector, { backgroundColor: states[i - 1] === 'done' ? Colors.success : Colors.border }]} />
            )}
            <View style={styles.step}>
              <View style={[styles.dot, { borderColor: dotColor, backgroundColor: state === 'idle' ? Colors.white : dotColor }]}>
                {icon ? <Ionicons name={icon} size={state === 'current' ? 8 : 12} color={Colors.white} /> : null}
              </View>
              <Text style={[styles.stepLabel, { color: state === 'idle' ? Colors.textSecondary : Colors.text }]} numberOfLines={1}>
                {step.label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: 4, backgroundColor: Colors.border, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  chipTxt: { color: Colors.white, fontSize: 11, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', marginVertical: 4 },
  step: { alignItems: 'center', width: 62 },
  connector: { flex: 1, height: 2, marginTop: -16 },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontSize: 10, fontWeight: '600', marginTop: 4, textAlign: 'center' },
});
