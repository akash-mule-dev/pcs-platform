// Point-pair registration panel (LiDAR only). Guides the inspector to tap a
// distinctive corner ON THE MODEL and then the SAME point in REALITY, building
// correspondence pairs. The rigid transform is solved live (rigid-registration.ts)
// and its RMS residual shown in mm, so the inspector can trust the fit before
// applying it. Scale is reported as a sanity check only — never applied.
//
// Pure RN (no native deps). Capture itself happens via taps on the camera (routed
// natively) or the "Place point" reticle button here; this panel only drives the
// flow + shows the readout.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { RigidFit } from './rigid-registration';

interface RegisterPanelProps {
  /** Completed model↔real pairs. */
  pairCount: number;
  /** A model point is captured and waiting for its real-world match. */
  awaitingReal: boolean;
  /** Live solve over the completed pairs (null until ≥1 pair). */
  fit: RigidFit | null;
  /** No surface/model was under the last capture. */
  miss?: boolean;
  /** Capture the next point at the screen-centre reticle (precise aiming). */
  onPlacePoint: () => void;
  onUndo: () => void;
  onClear: () => void;
  /** Bake the solved transform onto the model (enabled with ≥1 pair). */
  onApply: () => void;
  bottomOffset?: number;
  translucent?: boolean;
}

function fmt(n: number): string {
  return n >= 100 ? n.toFixed(0) : n.toFixed(1);
}

export default function RegisterPanel({
  pairCount,
  awaitingReal,
  fit,
  miss = false,
  onPlacePoint,
  onUndo,
  onClear,
  onApply,
  bottomOffset = 28,
  translucent = false,
}: RegisterPanelProps) {
  const scalePct = fit ? (fit.scaleSanity - 1) * 100 : 0;
  const scaleWarn = Math.abs(scalePct) > 5 ? 'bad' : Math.abs(scalePct) > 2 ? 'warn' : 'ok';
  const canApply = !!fit && fit.ok && pairCount >= 1;

  const instruction = awaitingReal
    ? 'Now tap the SAME corner in REALITY'
    : 'Tap a distinctive corner ON THE MODEL';

  // When RANSAC drops a mistapped pair, inlierCount < pairCount — say so, so the
  // on-screen marker count isn't misread as the points actually used in the fit.
  const usedNote = fit && fit.inlierCount < pairCount ? ` · using ${fit.inlierCount} of ${pairCount}` : '';
  const quality =
    (pairCount === 0
      ? 'Pick matching corners — 1 = move, 2 = + rotate, 3+ = full alignment'
      : pairCount < 3
        ? `${pairCount} pair${pairCount === 1 ? '' : 's'} — add ${3 - pairCount} more for full 6-DOF`
        : `${pairCount} pairs`) + usedNote;

  return (
    <View style={[styles.panel, { bottom: bottomOffset }]} pointerEvents="box-none">
      <View style={[styles.bar, translucent && styles.barTranslucent]}>
        {/* Step instruction */}
        <Text style={styles.instruction}>{instruction}</Text>
        {miss && <Text style={styles.miss}>No surface/model under the point — re-aim and try again</Text>}

        {/* Live readout */}
        <View style={styles.readout}>
          {fit ? (
            <>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{fmt(fit.rmsMm)}</Text>
                <Text style={styles.statLabel}>RMS mm</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{fmt(fit.maxErrMm)}</Text>
                <Text style={styles.statLabel}>max mm</Text>
              </View>
              <View style={styles.stat}>
                <Text
                  style={[
                    styles.statValue,
                    scaleWarn === 'warn' && styles.statWarn,
                    scaleWarn === 'bad' && styles.statBad,
                  ]}
                >
                  {scalePct >= 0 ? '+' : ''}
                  {scalePct.toFixed(1)}%
                </Text>
                <Text style={styles.statLabel}>scale</Text>
              </View>
            </>
          ) : (
            <Text style={styles.quality}>{quality}</Text>
          )}
        </View>
        {fit && <Text style={styles.quality}>{quality}</Text>}
        {fit && scaleWarn === 'bad' && (
          <Text style={styles.scaleAlert}>Scale off &gt;5% — wrong model or a bad point pick?</Text>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.placeBtn} onPress={onPlacePoint} activeOpacity={0.85}>
            <Text style={styles.placeBtnText}>＋ Place point</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onUndo} activeOpacity={0.7}>
            <Text style={styles.secondaryBtnText}>Undo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onClear} activeOpacity={0.7}>
            <Text style={styles.secondaryBtnText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.applyBtn, !canApply && styles.applyBtnDisabled]}
            onPress={onApply}
            disabled={!canApply}
            activeOpacity={0.85}
          >
            <Text style={styles.applyBtnText}>Apply alignment</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 22 },
  bar: {
    backgroundColor: 'rgba(13, 17, 23, 0.92)',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 18,
    maxWidth: '96%',
    alignItems: 'center',
    gap: 8,
  },
  barTranslucent: { backgroundColor: 'rgba(13, 17, 23, 0.55)' },
  instruction: { color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  miss: { color: '#fde68a', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  readout: { flexDirection: 'row', alignItems: 'flex-end', gap: 22, marginTop: 2 },
  stat: { alignItems: 'center', minWidth: 56 },
  statValue: { color: '#fff', fontSize: 22, fontWeight: '800' },
  statWarn: { color: '#fbbf24' },
  statBad: { color: '#f87171' },
  statLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 1 },
  quality: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  scaleAlert: { color: '#f87171', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap', justifyContent: 'center' },
  placeBtn: {
    backgroundColor: 'rgba(14, 165, 233, 0.97)',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 22,
    minHeight: 44,
    justifyContent: 'center',
  },
  placeBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  applyBtn: {
    backgroundColor: 'rgba(34, 197, 94, 0.95)',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 22,
    minHeight: 44,
    justifyContent: 'center',
  },
  applyBtnDisabled: { backgroundColor: 'rgba(34, 197, 94, 0.3)' },
  applyBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
