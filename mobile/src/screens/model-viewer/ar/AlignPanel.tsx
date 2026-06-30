// Consolidated AR model-alignment panel.
//
// Replaces the old three scattered, absolutely-positioned clusters (TiltControls,
// ScaleControls, Joystick) that overlapped each other (and the rest of the AR
// chrome) and left dead tap targets. This is ONE flex container docked above the
// toolbar, so its sections can never collide and every button has its own hit
// area. Sections: MOVE (X/Y/Z incl. depth), ROTATE (pitch/yaw/roll + 90/180
// quick-rotate), SCALE (±, with a live readout) + Lock.
//
// All buttons support press-and-hold for smooth continuous motion: the action
// fires once on press, then repeats on an interval until release. The panel is
// pure RN (no native deps) and stateless beyond its hold timers — every change
// is reported up via the callbacks, which the host applies to model state.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Vec3 } from './types';
import PanelSlider from './PanelSlider';

// Per-tick step sizes. A tap = one step; press-and-hold repeats every TICK_MS for
// a steady, predictable rate. Rotate + scale use fine steps so each change is
// gradual and smooth (no coarse jumps) — large turns use the 90°/180° buttons.
// Fine, precise nudges (~1 mm/tick → ~25 mm/s on hold): the MOVE buttons are for
// fine alignment — coarse repositioning is done by dragging the model directly.
// These are the BASE steps at sensitivity 1× (the tuned default feel); the
// SENSITIVITY slider multiplies them (see below).
const POS_STEP = 0.001; // metres per tick (~1 mm) — gentle + predictable
const ROT_STEP = 0.5; // degrees per tick — fine, gradual (was 1°)
const SCALE_STEP = 1.01; // +1% per tick — smooth, predictable (was 1.03 / +3% jumps)
const TICK_MS = 40; // ~25 steps/sec on hold → gentle, even motion

// SENSITIVITY — a global multiplier on every MOVE/ROTATE/SCALE step. Alignment is
// two-phase: drop the model roughly into place FAST, then dial in the last few mm
// SLOWLY. One slider covers both. Default 1× is the tuned per-tick feel above; the
// user slides up for coarse speed, down for fine precision.
//   • MOVE/ROTATE steps are multiplied linearly (×8 = 8 mm/tick, ×0.2 = 0.2 mm/tick).
//   • SCALE is multiplicative, so the per-tick % is raised to the sensitivity power
//     (SCALE_STEP**sens) — keeping ratios symmetric for smaller/bigger.
// Slider runs in LOG space so equal travel = equal ratio change and 1× lands near
// the centre instead of bunched at the low end.
const SENS_MIN = 0.2; // fine — 1/5 of the default step
const SENS_MAX = 8; // fast — 8× the default step
const SENS_DEFAULT = 1; // the tuned default feel ("buttons sensitivity is great")
const SENS_LOG_MIN = Math.log(SENS_MIN);
const SENS_LOG_MAX = Math.log(SENS_MAX);
const SENS_LOG_DEFAULT = Math.log(SENS_DEFAULT);
const SENS_WIDTH = 184;

// Axis colours — MUST match the native XYZ gizmo (PcsLidarArView.rebuildAxes:
// X=red, Y=green, Z=blue) so a rotate button and the axis it spins read as the same
// colour. The operator turns on the gizmo, then "the green button spins the green
// axis" — no guessing which of Tilt/Turn/Roll is which.
const AXIS_X = '#E5392F'; // red   — Tilt (pitch, about X)
const AXIS_Y = '#22A447'; // green — Turn (yaw, about Y)
const AXIS_Z = '#1F8FE5'; // blue  — Roll (about Z)

interface AlignPanelProps {
  scale: Vec3;
  locked: boolean;
  /** Relative position nudge in metres [dx, dy, dz]. */
  onNudgePosition: (delta: Vec3) => void;
  /** Relative rotation nudge in degrees [pitch, yaw, roll]. */
  onNudgeRotation: (delta: Vec3) => void;
  /** Relative uniform scale multiply. */
  onScaleBy: (factor: number) => void;
  /** One-shot yaw rotation in degrees (90 / 180 quick-rotate). */
  onQuickRotate: (deg: number) => void;
  onToggleLock: () => void;
  /** Distance from the bottom edge. Default clears the bottom toolbar (148); the
   *  LiDAR layout (toolbar on the right) passes a small value so it docks low. */
  bottomOffset?: number;
  /** Use a more see-through panel background (so the model stays visible while
   *  aligning). The buttons themselves are unchanged. */
  translucent?: boolean;
  /** LiDAR only: one-tap ICP refinement onto the scanned mesh. Renders an
   *  "Auto-snap" button only when provided (Viro never passes it). */
  onAutoSnap?: () => void;
  /** View toggles relocated here (below SCALE) from the top-right chips. Each renders
   *  a toggle button only when its handler is provided. */
  occlusionOn?: boolean;
  onToggleOcclusion?: () => void;
  axesOn?: boolean;
  onToggleAxes?: () => void;
}

/** A button that fires `onHold` once on press and then repeats while held. */
function HoldButton({
  glyph,
  caption,
  onHold,
  locked,
  repeat = true,
  wide = false,
  accent,
}: {
  glyph: string;
  caption: string;
  onHold: () => void;
  locked: boolean;
  repeat?: boolean;
  wide?: boolean;
  /** Axis colour (gizmo-matched). When set, the button gets a coloured border and the
   *  glyph/caption are tinted to it — so the button maps to its XYZ-gizmo axis. */
  accent?: string;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onHoldRef = useRef(onHold);
  onHoldRef.current = onHold;

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (locked) return;
    onHoldRef.current(); // immediate response to a tap
    if (!repeat || timer.current !== null) return;
    timer.current = setInterval(() => onHoldRef.current(), TICK_MS);
  }, [locked, repeat]);

  useEffect(() => stop, [stop]);

  return (
    <TouchableOpacity
      style={[
        styles.btn,
        wide && styles.btnWide,
        accent && { borderWidth: 2, borderColor: accent },
        locked && styles.btnDisabled,
      ]}
      onPressIn={start}
      onPressOut={stop}
      disabled={locked}
      activeOpacity={0.6}
    >
      <Text style={[styles.btnGlyph, accent && { color: accent }]}>{glyph}</Text>
      <Text style={[styles.btnCaption, accent && { color: accent }]}>{caption}</Text>
    </TouchableOpacity>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export default function AlignPanel({
  scale,
  locked,
  onNudgePosition,
  onNudgeRotation,
  onScaleBy,
  onQuickRotate,
  onToggleLock,
  bottomOffset = 148,
  translucent = false,
  onAutoSnap,
  occlusionOn = false,
  onToggleOcclusion,
  axesOn = false,
  onToggleAxes,
}: AlignPanelProps) {
  const scaleLabel = `${(scale[0] ?? 1).toFixed(2)}×`;

  // Sensitivity lives in LOG space (the slider's raw value); the multiplier is its
  // exp. Local state — it resets to 1× whenever the panel remounts (i.e. each new
  // alignment session), which is the right default, and persists across lock/unlock.
  const [sensLog, setSensLog] = useState(SENS_LOG_DEFAULT);
  const sens = Math.exp(sensLog);
  const posStep = POS_STEP * sens; // metres/tick at the current sensitivity
  const rotStep = ROT_STEP * sens; // degrees/tick at the current sensitivity
  const scaleUp = Math.pow(SCALE_STEP, sens); // per-tick scale factor (bigger)

  return (
    <View style={[styles.panel, { bottom: bottomOffset }]} pointerEvents="box-none">
      {/* SENSITIVITY strip — a global step multiplier for every control below.
          Its own slim row above the button bar so it never widens the bar. */}
      {!locked && (
        <View style={[styles.sensBar, translucent && styles.barTranslucent]}>
          <Text style={styles.sectionTitle}>SENSITIVITY</Text>
          <View style={styles.sensRow}>
            <Text style={styles.sensEnd}>Fine</Text>
            <PanelSlider
              value={sensLog}
              min={SENS_LOG_MIN}
              max={SENS_LOG_MAX}
              width={SENS_WIDTH}
              onComplete={setSensLog}
              formatValue={(v) => {
                const m = Math.exp(v);
                return `${m < 1 ? m.toFixed(2) : m.toFixed(1)}×`;
              }}
            />
            <Text style={styles.sensEnd}>Fast</Text>
          </View>
        </View>
      )}

      <View style={[styles.bar, translucent && styles.barTranslucent]}>
        {/* When locked the transform can't change, so the move/rotate/scale
            controls are hidden — only the unlock control remains. */}
        {!locked && (
          <>
            {/* ── MOVE: X (left/right), Y (up/down), Z (near/far depth) ── */}
            <Section title="MOVE">
              <View style={styles.grid}>
                <HoldButton glyph="◀" caption="Left" locked={locked} onHold={() => onNudgePosition([-posStep, 0, 0])} />
                <HoldButton glyph="▲" caption="Up" locked={locked} onHold={() => onNudgePosition([0, posStep, 0])} />
                <HoldButton glyph="▶" caption="Right" locked={locked} onHold={() => onNudgePosition([posStep, 0, 0])} />
                <HoldButton glyph="⊕" caption="Near" locked={locked} onHold={() => onNudgePosition([0, 0, posStep])} />
                <HoldButton glyph="▼" caption="Down" locked={locked} onHold={() => onNudgePosition([0, -posStep, 0])} />
                <HoldButton glyph="⊖" caption="Far" locked={locked} onHold={() => onNudgePosition([0, 0, -posStep])} />
              </View>
            </Section>

            <View style={styles.divider} />

            {/* ── ROTATE: all three axes — Tilt (pitch / X / red), Turn (yaw / Y /
                green), Roll (roll / Z / blue), each ±, plus the 90°/180° quick yaw.
                Captions name the axis + direction and the colour matches the XYZ
                gizmo, so each button maps to the axis it spins. ── */}
            <Section title="ROTATE">
              <View style={styles.grid}>
                <HoldButton glyph="⤢" caption="Tilt+ X" accent={AXIS_X} locked={locked} onHold={() => onNudgeRotation([rotStep, 0, 0])} />
                <HoldButton glyph="↺" caption="Turn+ Y" accent={AXIS_Y} locked={locked} onHold={() => onNudgeRotation([0, rotStep, 0])} />
                <HoldButton glyph="⟲" caption="Roll+ Z" accent={AXIS_Z} locked={locked} onHold={() => onNudgeRotation([0, 0, rotStep])} />
                <HoldButton glyph="⤡" caption="Tilt− X" accent={AXIS_X} locked={locked} onHold={() => onNudgeRotation([-rotStep, 0, 0])} />
                <HoldButton glyph="↻" caption="Turn− Y" accent={AXIS_Y} locked={locked} onHold={() => onNudgeRotation([0, -rotStep, 0])} />
                <HoldButton glyph="⟳" caption="Roll− Z" accent={AXIS_Z} locked={locked} onHold={() => onNudgeRotation([0, 0, -rotStep])} />
              </View>
              <View style={styles.quickRow}>
                <HoldButton glyph="90°" caption="Turn" locked={locked} repeat={false} wide onHold={() => onQuickRotate(90)} />
                <HoldButton glyph="180°" caption="Flip" locked={locked} repeat={false} wide onHold={() => onQuickRotate(180)} />
              </View>
            </Section>

            <View style={styles.divider} />

            {/* ── SCALE ── */}
            <Section title="SCALE">
              <View style={styles.scaleRow}>
                <HoldButton glyph="−" caption="Smaller" locked={locked} onHold={() => onScaleBy(1 / scaleUp)} />
                <View style={styles.scaleReadout}>
                  <Text style={styles.scaleReadoutText}>{scaleLabel}</Text>
                </View>
                <HoldButton glyph="+" caption="Bigger" locked={locked} onHold={() => onScaleBy(scaleUp)} />
              </View>
            </Section>

            {/* ── VIEW toggles (Occlusion + XYZ Axes), docked below SCALE ── */}
            {(onToggleOcclusion || onToggleAxes) && (
              <>
                <View style={styles.divider} />
                <Section title="VIEW">
                  <View style={styles.viewToggleCol}>
                    {onToggleOcclusion && (
                      <TouchableOpacity
                        style={[styles.viewToggle, occlusionOn && styles.viewToggleOn]}
                        onPress={onToggleOcclusion}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.viewToggleText}>👁  Occlusion  {occlusionOn ? 'ON' : 'OFF'}</Text>
                      </TouchableOpacity>
                    )}
                    {onToggleAxes && (
                      <TouchableOpacity
                        style={[styles.viewToggle, axesOn && styles.viewToggleOn]}
                        onPress={onToggleAxes}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.viewToggleText}>✛  Axes  {axesOn ? 'ON' : 'OFF'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </Section>
              </>
            )}

            {onAutoSnap && (
              <>
                <View style={styles.divider} />
                <Section title="LIDAR">
                  <TouchableOpacity style={styles.autoBtn} onPress={onAutoSnap} activeOpacity={0.8}>
                    <Text style={styles.autoBtnGlyph}>⊹</Text>
                    <Text style={styles.autoBtnText}>Auto-snap</Text>
                  </TouchableOpacity>
                </Section>
              </>
            )}

            <View style={styles.divider} />
          </>
        )}

        {/* ── LOCK — always shown; the only control left once locked ── */}
        <Section title={locked ? 'LOCKED' : 'LOCK'}>
          <TouchableOpacity
            style={[styles.lockBtn, locked ? styles.lockBtnLocked : styles.lockBtnUnlocked]}
            onPress={onToggleLock}
            activeOpacity={0.8}
          >
            <Text style={styles.lockBtnText}>{locked ? '🔒 Tap to unlock' : '🔓 Lock'}</Text>
          </TouchableOpacity>
        </Section>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Clears the toolbar (~129px tall: 40 safe-area + ~65 button + 24 padding)
    // so the panel sits ABOVE the tabs instead of overlaying them.
    bottom: 148,
    alignItems: 'center',
    zIndex: 22,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 18,
    backgroundColor: 'rgba(13, 17, 23, 0.92)',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 18,
    maxWidth: '98%',
  },
  barTranslucent: { backgroundColor: 'rgba(13, 17, 23, 0.45)' },
  sensBar: {
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(13, 17, 23, 0.92)',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
    maxWidth: '98%',
  },
  sensRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sensEnd: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700' },
  section: { alignItems: 'center' },
  sectionTitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  sectionBody: { alignItems: 'center', gap: 8 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 3 * 68 + 2 * 8, // 3 columns of 68 + gaps
    justifyContent: 'center',
    gap: 8,
  },
  quickRow: { flexDirection: 'row', gap: 8 },
  scaleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewToggleCol: { gap: 8, alignItems: 'stretch' },
  viewToggle: {
    minWidth: 150,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewToggleOn: { backgroundColor: 'rgba(14, 165, 233, 0.97)' },
  viewToggleText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  scaleReadout: {
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  scaleReadoutText: { color: '#ffffff', fontSize: 19, fontWeight: '800' },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.14)' },
  btn: {
    width: 68,
    height: 64,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnWide: { width: 104 },
  btnDisabled: { opacity: 0.4 },
  btnGlyph: { color: '#0f172a', fontSize: 24, fontWeight: '800', lineHeight: 28 },
  btnCaption: { color: '#334155', fontSize: 11, fontWeight: '700', marginTop: 2 },
  lockBtn: {
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  lockBtnUnlocked: { backgroundColor: 'rgba(34, 197, 94, 0.92)' },
  lockBtnLocked: { backgroundColor: 'rgba(239, 68, 68, 0.92)' },
  lockBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  autoBtn: {
    minWidth: 96,
    height: 64,
    borderRadius: 14,
    backgroundColor: 'rgba(14, 165, 233, 0.97)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  autoBtnGlyph: { color: '#fff', fontSize: 22, fontWeight: '800', lineHeight: 26 },
  autoBtnText: { color: '#fff', fontSize: 12, fontWeight: '800', marginTop: 2 },
});
