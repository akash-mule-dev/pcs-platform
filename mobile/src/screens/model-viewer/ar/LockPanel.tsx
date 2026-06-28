// LockPanel — the Stability tool (FabStation-style anti-drift) for the LiDAR AR
// inspector. Arms image-marker lock + continuous ICP world-lock, shows live lock
// health, and binds/prints the printed markers.
//
// Workflow: align the model (drag / Points / Auto-snap) → aim at a printed marker on
// the steel → Bind → the model is thereafter pinned to that marker (and re-anchors to
// the nearest marker as you walk the piece), so it can't drift off the real assembly.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LockState, lockStateLabel } from './drift-monitor';

interface Props {
  bottom: number;
  markerLockOn: boolean;
  continuousLockOn: boolean;
  lockState: LockState;
  activeMarker: string | null;
  trackedCount: number;
  boundCount: number;
  markerVisible: boolean;
  holding: boolean;
  lastResidualMm: number | null;
  onToggleMarkerLock: () => void;
  onToggleContinuousLock: () => void;
  onBind: () => void;
  onClearBindings: () => void;
  onPrintMarkers: () => void;
}

const STATE_COLOR: Record<LockState, string> = {
  locked: '#10b981',
  refining: '#0ea5e9',
  drifting: '#f59e0b',
  searching: '#64748b',
  lost: '#ef4444',
};

function Toggle({ label, sub, on, onPress }: { label: string; sub: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.toggle, on && styles.toggleOn]} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.toggleText}>
        <Text style={[styles.toggleLabel, on && styles.toggleLabelOn]}>{label}</Text>
        <Text style={styles.toggleSub} numberOfLines={1}>{sub}</Text>
      </View>
      <View style={[styles.knob, on && styles.knobOn]}>
        <Text style={[styles.knobText, on && styles.knobTextOn]}>{on ? 'ON' : 'OFF'}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function LockPanel({
  bottom,
  markerLockOn,
  continuousLockOn,
  lockState,
  activeMarker,
  trackedCount,
  boundCount,
  markerVisible,
  holding,
  lastResidualMm,
  onToggleMarkerLock,
  onToggleContinuousLock,
  onBind,
  onClearBindings,
  onPrintMarkers,
}: Props) {
  const canBind = markerLockOn && markerVisible;
  return (
    <View style={[styles.panel, { bottom }]} pointerEvents="box-none">
      <View style={styles.card}>
        {/* Status row */}
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: STATE_COLOR[lockState] }]} />
          <Text style={styles.statusText}>{lockStateLabel(lockState)}</Text>
          {lastResidualMm != null && (
            <Text style={styles.residual}>±{lastResidualMm.toFixed(1)} mm</Text>
          )}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {!markerLockOn
            ? 'Marker lock off'
            : holding
              ? `Holding last pose — re-aim at a marker · ${boundCount} bound`
              : activeMarker
                ? `Fused on ${trackedCount} marker(s) · primary ${activeMarker} · ${boundCount} bound`
                : `${trackedCount} marker(s) in view · ${boundCount} bound`}
        </Text>

        <Toggle
          label="Marker lock"
          sub="Pin the model to printed markers on the steel"
          on={markerLockOn}
          onPress={onToggleMarkerLock}
        />
        <Toggle
          label="Continuous lock"
          sub="Auto-correct drift onto the scanned surface"
          on={continuousLockOn}
          onPress={onToggleContinuousLock}
        />

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, !canBind && styles.btnDisabled]}
            onPress={onBind}
            disabled={!canBind}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>Bind to marker</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost, boundCount === 0 && styles.btnDisabled]}
            onPress={onClearBindings}
            disabled={boundCount === 0}
            activeOpacity={0.85}
          >
            <Text style={styles.btnTextGhost}>Clear</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[styles.btn, styles.btnGhost, styles.printBtn]} onPress={onPrintMarkers} activeOpacity={0.85}>
          <Text style={styles.btnTextGhost}>⎙  Print marker sheet</Text>
        </TouchableOpacity>

        <Text style={styles.hint} numberOfLines={2}>
          {markerLockOn && !markerVisible
            ? 'Aim the camera at a printed marker, then Bind.'
            : 'Align the model first, aim at a marker on the steel, then Bind.'}
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { color: '#f1f5f9', fontSize: 16, fontWeight: '800', flex: 1 },
  residual: { color: '#cbd5e1', fontSize: 13, fontWeight: '700' },
  meta: { color: '#94a3b8', fontSize: 12, marginTop: 4, marginBottom: 12 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  toggleOn: { borderColor: 'rgba(16, 185, 129, 0.7)', backgroundColor: 'rgba(16, 185, 129, 0.16)' },
  toggleText: { flex: 1, paddingRight: 8 },
  toggleLabel: { color: '#e2e8f0', fontSize: 14, fontWeight: '700' },
  toggleLabelOn: { color: '#ffffff' },
  toggleSub: { color: '#94a3b8', fontSize: 11, marginTop: 1 },
  knob: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(100, 116, 139, 0.5)' },
  knobOn: { backgroundColor: '#10b981' },
  knobText: { color: '#cbd5e1', fontSize: 11, fontWeight: '800' },
  knobTextOn: { color: '#06281d' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btn: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#0ea5e9' },
  btnGhost: { backgroundColor: 'rgba(51, 65, 85, 0.85)' },
  btnDisabled: { opacity: 0.4 },
  printBtn: { marginTop: 8, flex: 0 },
  btnText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  btnTextGhost: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  hint: { color: '#cbd5e1', fontSize: 11, marginTop: 10, textAlign: 'center' },
});
