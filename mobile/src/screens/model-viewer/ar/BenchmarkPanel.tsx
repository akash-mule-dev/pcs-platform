// BenchmarkPanel — the on-device stability A/B for QA / benchmarking. Records a
// markers-OFF run then a markers-ON run (the parent toggles marker lock around each),
// then prints the headline "how much steadier the overlay sits on the real assembly"
// and offers an export of the session log. Pure RN; the recording state + math come
// from useStabilityBenchmark / stability-benchmark.ts.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { RunMetrics, BenchmarkComparison } from './stability-benchmark';

interface Props {
  bottom: number;
  recording: 'off' | 'on' | null;
  elapsedMs: number;
  runMs: number;
  offMetrics: RunMetrics | null;
  onMetrics: RunMetrics | null;
  comparison: BenchmarkComparison | null;
  markerVisible: boolean;
  exporting?: boolean;
  onStartOff: () => void;
  onStartOn: () => void;
  onStop: () => void;
  onReset: () => void;
  onExport: () => void;
}

function RunButton({
  index,
  label,
  recording,
  metrics,
  busyOther,
  elapsedMs,
  runMs,
  onStart,
  onStop,
}: {
  index: string;
  label: string;
  recording: boolean;
  metrics: RunMetrics | null;
  busyOther: boolean;
  elapsedMs: number;
  runMs: number;
  onStart: () => void;
  onStop: () => void;
}) {
  const secs = Math.min(runMs, elapsedMs) / 1000;
  const total = Math.round(runMs / 1000);
  return (
    <TouchableOpacity
      style={[styles.run, recording && styles.runRecording, busyOther && styles.disabled]}
      onPress={recording ? onStop : onStart}
      disabled={busyOther}
      activeOpacity={0.85}
    >
      <View style={styles.runText}>
        <Text style={styles.runLabel}>
          {index}  {label}
        </Text>
        <Text style={styles.runSub} numberOfLines={1}>
          {recording
            ? `Recording… ${secs.toFixed(0)}/${total}s · tap to stop`
            : metrics
              ? `✓ drift ±${metrics.driftRmsMm.toFixed(1)} mm · jitter ±${metrics.jitterRmsMm.toFixed(1)} mm · tap to re-run`
              : 'Tap to record (~12 s)'}
        </Text>
      </View>
      <View style={[styles.runDot, recording ? styles.runDotRec : metrics ? styles.runDotDone : undefined]}>
        <Text style={styles.runDotText}>{recording ? '■' : metrics ? '✓' : '●'}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function BenchmarkPanel({
  bottom,
  recording,
  elapsedMs,
  runMs,
  offMetrics,
  onMetrics,
  comparison,
  markerVisible,
  exporting,
  onStartOff,
  onStartOn,
  onStop,
  onReset,
  onExport,
}: Props) {
  const ready = !!comparison;
  const improved = !!comparison?.improved;
  return (
    <View style={[styles.panel, { bottom }]} pointerEvents="box-none">
      <View style={styles.card}>
        <Text style={styles.title}>Stability benchmark</Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          Measures how far the overlay drifts off the real assembly — markers OFF vs ON,
          relative to a tracked marker.
        </Text>

        <RunButton
          index="1"
          label="Without markers"
          recording={recording === 'off'}
          metrics={offMetrics}
          busyOther={recording === 'on'}
          elapsedMs={elapsedMs}
          runMs={runMs}
          onStart={onStartOff}
          onStop={onStop}
        />
        <RunButton
          index="2"
          label="With markers"
          recording={recording === 'on'}
          metrics={onMetrics}
          busyOther={recording === 'off'}
          elapsedMs={elapsedMs}
          runMs={runMs}
          onStart={onStartOn}
          onStop={onStop}
        />

        {comparison && (
          <View style={[styles.result, improved ? styles.resultGood : styles.resultNeutral]}>
            <Text style={[styles.resultBig, { color: improved ? '#10b981' : '#f59e0b' }]}>
              {improved
                ? `${comparison.driftReductionMm.toFixed(1)} mm steadier (${Math.round(comparison.driftReductionPct)}%)`
                : 'No improvement this run'}
            </Text>
            <Text style={styles.resultLine} numberOfLines={3}>{comparison.verdict}</Text>
            <Text style={styles.resultMeta}>
              jitter {comparison.off.jitterRmsMm.toFixed(1)} → {comparison.on.jitterRmsMm.toFixed(1)} mm
            </Text>
          </View>
        )}

        {!markerVisible && recording == null && !ready && (
          <Text style={styles.warn}>Aim at a printed marker first — keep one in view for both runs.</Text>
        )}

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, (!ready || exporting) && styles.disabled]}
            onPress={onExport}
            disabled={!ready || exporting}
            activeOpacity={0.85}
          >
            {exporting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnText}>⤓  Export log</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost, (!offMetrics && !onMetrics) && styles.disabled]}
            onPress={onReset}
            disabled={!offMetrics && !onMetrics}
            activeOpacity={0.85}
          >
            <Text style={styles.btnTextGhost}>Reset</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.hint} numberOfLines={2}>
          Hold the iPad aimed at the assembly with a marker visible for each run. Run 1 with
          Marker lock off, run 2 with it on — the panel does the rest.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  card: {
    width: 340,
    backgroundColor: 'rgba(13, 17, 23, 0.94)',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.25)',
  },
  title: { color: '#f1f5f9', fontSize: 16, fontWeight: '800' },
  subtitle: { color: '#94a3b8', fontSize: 11, marginTop: 3, marginBottom: 12 },
  run: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  runRecording: { borderColor: 'rgba(239, 68, 68, 0.7)', backgroundColor: 'rgba(239, 68, 68, 0.14)' },
  disabled: { opacity: 0.4 },
  runText: { flex: 1, paddingRight: 8 },
  runLabel: { color: '#e2e8f0', fontSize: 14, fontWeight: '700' },
  runSub: { color: '#94a3b8', fontSize: 11, marginTop: 1 },
  runDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.5)' },
  runDotRec: { backgroundColor: '#ef4444' },
  runDotDone: { backgroundColor: '#10b981' },
  runDotText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  result: { borderRadius: 12, padding: 12, marginTop: 2, marginBottom: 4, borderWidth: 1 },
  resultGood: { backgroundColor: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.5)' },
  resultNeutral: { backgroundColor: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.4)' },
  resultBig: { fontSize: 17, fontWeight: '800' },
  resultLine: { color: '#cbd5e1', fontSize: 11, marginTop: 4 },
  resultMeta: { color: '#94a3b8', fontSize: 10, marginTop: 4 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#0ea5e9' },
  btnGhost: { backgroundColor: 'rgba(51, 65, 85, 0.85)' },
  btnText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  btnTextGhost: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  warn: { color: '#f59e0b', fontSize: 11, fontWeight: '700', marginTop: 4, marginBottom: 4, textAlign: 'center' },
  hint: { color: '#cbd5e1', fontSize: 11, marginTop: 10, textAlign: 'center' },
});
