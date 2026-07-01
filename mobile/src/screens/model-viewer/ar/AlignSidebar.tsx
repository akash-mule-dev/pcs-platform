// AlignSidebar — a SELF-CONTAINED alignment control panel modelled on the reference
// AR app's layout (ROLL dial, SCALE slider, a rotation D-pad, a FRONT/BACK depth
// jog, a move D-pad, and 90°/180° quick-rotate).
//
// IMPORTANT: this file deliberately reuses NOTHING from the existing align UI
// (AlignPanel / PanelSlider / the host's align handlers). It is purely additive —
// it drives the native RealityKit view directly through the `arRef` bridge
// (nudge / rotateModel / scaleModel), so dropping it in cannot affect the
// existing, demo-critical alignment flow. Excluded by request: "Local Mode" and
// "Tracking Visuals" toggles, and all the top nav (Home/Visuals/Tools/etc.).
//
// Every motion button supports press-and-hold: fires once on press, then repeats
// on an interval until release. The ROLL dial and the two sliders are custom
// PanResponder controls (no native Slider dependency).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, ScrollView } from 'react-native';

type V3 = [number, number, number];

// Per-tick steps (tap = one step; hold repeats every TICK_MS). Tuned for fine,
// predictable alignment nudges — coarse work is done by dragging the model.
const POS_STEP = 0.002; // metres/tick (~2 mm)
const ROT_STEP = 0.5; // degrees/tick
const TICK_MS = 45; // ~22 steps/sec on hold
// ROLL dial gear-reduction: the model rolls only ROLL_DAMP° per 1° of finger drag around
// the dial (before the sensitivity multiplier). The raw 1:1 dial was far too twitchy.
const ROLL_DAMP = 0.28;
// Ignore dial touches within this fraction of the dial radius of the centre — atan2 is
// unstable near the centre, so tiny moves there produced huge, jumpy roll deltas.
const ROLL_DEADZONE_FRAC = 0.28;
const SCALE_MIN = 0.05;
const SCALE_MAX = 20;
const DEPTH_STEP = 0.004; // metres/tick for FRONT/BACK depth (slightly > MOVE so it reads)
// SCALE is ADDITIVE/linear, matching FabStation (decompiled: `_scale += value` then
// localScale set absolutely — NOT a multiplicative %). FabStation's scale factor (0.30)
// is 6× its general factor (0.05), i.e. scale is far more responsive than move/rotate;
// this additive step encodes that aggressive feel (± per tick, × sensitivity).
const SCALE_STEP = 0.03; // additive scale units/tick at 1× sensitivity

// SENSITIVITY — a global multiplier on every MOVE / ROTATE / DEPTH / ROLL step, so
// the operator can drop the model in fast then dial in the last few mm slowly. The
// default is deliberately calm (0.5×) because the raw steps felt over-reactive.
// SCALE and the exact 90°/180° quick-turns are NOT scaled. Log-spaced so equal
// slider travel = equal ratio change.
const SENS_MIN = 0.15; // very fine
const SENS_MAX = 3; // fast
const SENS_DEFAULT = 0.5; // calmer than 1× out of the box
const SENS_LOG_MIN = Math.log(SENS_MIN);
const SENS_LOG_MAX = Math.log(SENS_MAX);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface AlignSidebarProps {
  /** The native PcsLidarArView ref — the sidebar calls its imperative methods. */
  arRef: React.MutableRefObject<any>;
  /** Close the sidebar. */
  onClose: () => void;
}

/** Press-and-hold helper: fires `action` once, then repeats while held. */
function useHold(action: () => void) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ref = useRef(action);
  ref.current = action;
  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);
  const start = useCallback(() => {
    ref.current();
    if (timer.current !== null) return;
    timer.current = setInterval(() => ref.current(), TICK_MS);
  }, []);
  useEffect(() => stop, [stop]);
  return { start, stop };
}

/** A single press-and-hold button (an arrow / glyph). */
function PadButton({
  glyph,
  caption,
  onHold,
  style,
  accent,
}: {
  glyph: string;
  caption?: string;
  onHold: () => void;
  style?: any;
  accent?: string;
}) {
  const { start, stop } = useHold(onHold);
  return (
    <TouchableOpacity
      style={[styles.pad, accent ? { borderColor: accent, borderWidth: 2 } : null, style]}
      onPressIn={start}
      onPressOut={stop}
      activeOpacity={0.6}
    >
      <Text style={[styles.padGlyph, accent ? { color: accent } : null]}>{glyph}</Text>
      {caption ? <Text style={[styles.padCaption, accent ? { color: accent } : null]}>{caption}</Text> : null}
    </TouchableOpacity>
  );
}

/** A 4-way directional pad: up / down / left / right around an empty hub. */
function FourWayPad({
  title,
  upGlyph,
  downGlyph,
  leftGlyph,
  rightGlyph,
  upCap,
  downCap,
  leftCap,
  rightCap,
  onUp,
  onDown,
  onLeft,
  onRight,
  accentVert,
  accentHoriz,
}: {
  title: string;
  upGlyph: string;
  downGlyph: string;
  leftGlyph: string;
  rightGlyph: string;
  upCap: string;
  downCap: string;
  leftCap: string;
  rightCap: string;
  onUp: () => void;
  onDown: () => void;
  onLeft: () => void;
  onRight: () => void;
  accentVert?: string;
  accentHoriz?: string;
}) {
  return (
    <View style={styles.ctrlBlock}>
      <Text style={styles.ctrlTitle}>{title}</Text>
      <View style={styles.padRow}>
        <View style={styles.padSpacer} />
        <PadButton glyph={upGlyph} caption={upCap} onHold={onUp} accent={accentVert} />
        <View style={styles.padSpacer} />
      </View>
      <View style={styles.padRow}>
        <PadButton glyph={leftGlyph} caption={leftCap} onHold={onLeft} accent={accentHoriz} />
        <View style={styles.padHub} />
        <PadButton glyph={rightGlyph} caption={rightCap} onHold={onRight} accent={accentHoriz} />
      </View>
      <View style={styles.padRow}>
        <View style={styles.padSpacer} />
        <PadButton glyph={downGlyph} caption={downCap} onHold={onDown} accent={accentVert} />
        <View style={styles.padSpacer} />
      </View>
    </View>
  );
}

/** Rotary ROLL dial — spin it to roll the model about the view axis. The drag
 *  angle around the dial centre is differentiated into a per-move roll delta. */
function RollDial({ onRoll }: { onRoll: (deg: number) => void }) {
  const SIZE = 92;
  const [angle, setAngle] = useState(0);
  const lastRef = useRef<number | null>(null);
  const accumRef = useRef(0);

  const DEAD2 = (SIZE * ROLL_DEADZONE_FRAC) * (SIZE * ROLL_DEADZONE_FRAC);
  const angleAt = (x: number, y: number): number | null => {
    const dx = x - SIZE / 2;
    const dy = y - SIZE / 2;
    if (dx * dx + dy * dy < DEAD2) return null; // too close to centre → atan2 unstable
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        lastRef.current = angleAt(e.nativeEvent.locationX, e.nativeEvent.locationY);
      },
      onPanResponderMove: (e) => {
        const a = angleAt(e.nativeEvent.locationX, e.nativeEvent.locationY);
        if (a == null) return; // inside the dead-zone this frame — keep last baseline
        if (lastRef.current == null) {
          lastRef.current = a;
          return;
        }
        let d = a - lastRef.current;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        lastRef.current = a;
        // Visual indicator follows the finger 1:1; the MODEL rolls gear-reduced (ROLL_DAMP)
        // so a big, comfortable dial spin makes a small, controllable roll.
        accumRef.current += d;
        setAngle(accumRef.current);
        onRoll(d * ROLL_DAMP);
      },
      onPanResponderRelease: () => {
        // Spring the indicator back to its home (pointing up) on release — the model
        // keeps the roll already applied; only the dial visual recentres so it's
        // ready for the next spin (a self-centring knob, not an absolute one).
        lastRef.current = null;
        accumRef.current = 0;
        setAngle(0);
      },
      onPanResponderTerminate: () => {
        lastRef.current = null;
        accumRef.current = 0;
        setAngle(0);
      },
    }),
  ).current;

  return (
    <View style={styles.ctrlBlock}>
      <Text style={styles.ctrlTitle}>ROLL</Text>
      <View style={[styles.dial, { width: SIZE, height: SIZE, borderRadius: SIZE / 2 }]} {...pan.panHandlers}>
        {/* Rotating indicator — a tick from centre to the top edge. */}
        <View style={[styles.dialIndicator, { transform: [{ rotate: `${angle}deg` }] }]}>
          <View style={styles.dialTick} />
          <View style={styles.dialDot} />
        </View>
        <Text style={styles.dialGlyph}>⟳</Text>
      </View>
    </View>
  );
}

/** SCALE — − / + press-and-hold buttons with a live readout. ADDITIVE like FabStation
 *  (`_scale ± value`, applied absolutely), scaled by the sensitivity slider. The native
 *  scaleModel is multiplicative, so we convert the additive target to a factor
 *  (next / current). Clamped to 0.05× … 20×. */
function ScaleButtons({
  onScaleBy,
  sensRef,
}: {
  onScaleBy: (factor: number) => void;
  sensRef: React.MutableRefObject<number>;
}) {
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);

  const step = (dir: 1 | -1) => {
    const s = sensRef.current;
    const next = clamp(scaleRef.current + SCALE_STEP * s * dir, SCALE_MIN, SCALE_MAX);
    const applied = next / scaleRef.current;
    if (Number.isFinite(applied) && applied > 0 && applied !== 1) onScaleBy(applied);
    scaleRef.current = next;
    setScale(next);
  };

  return (
    <View style={styles.ctrlBlock}>
      <Text style={styles.ctrlTitle}>SCALE</Text>
      <View style={styles.scaleRow}>
        <PadButton glyph="−" caption="Smaller" onHold={() => step(-1)} style={styles.scaleBtn} />
        <View style={styles.scaleReadout}>
          <Text style={styles.scaleReadoutText}>{scale < 1 ? scale.toFixed(2) : scale.toFixed(1)}×</Text>
        </View>
        <PadButton glyph="+" caption="Bigger" onHold={() => step(1)} style={styles.scaleBtn} />
      </View>
    </View>
  );
}

/** FRONT / BACK depth — press-and-hold buttons using the SAME mechanism as the
 *  (working) MOVE pad. Front = toward the viewer, Back = away. This replaced a
 *  spring-slider jog that read as "not moving" (fragile gesture capture inside the
 *  scroll view + near-imperceptible motion on a large 1:1 model). */
function DepthButtons({ onFront, onBack }: { onFront: () => void; onBack: () => void }) {
  return (
    <View style={styles.ctrlBlock}>
      <Text style={styles.ctrlTitle}>DEPTH</Text>
      <View style={styles.depthRow}>
        <PadButton glyph="⊕" caption="Front" onHold={onFront} style={styles.depthBtn} />
        <PadButton glyph="⊖" caption="Back" onHold={onBack} style={styles.depthBtn} />
      </View>
    </View>
  );
}

/** SENSITIVITY slider — horizontal, log-spaced, reports a step multiplier. */
function SensSlider({ initial, onChange }: { initial: number; onChange: (m: number) => void }) {
  const W = 150;
  const [mult, setMult] = useState(initial);
  const multFromX = (x: number) =>
    Math.exp(SENS_LOG_MIN + clamp(x / W, 0, 1) * (SENS_LOG_MAX - SENS_LOG_MIN));
  const apply = (x: number) => {
    const m = multFromX(x);
    setMult(m);
    onChange(m);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => apply(e.nativeEvent.locationX),
      onPanResponderMove: (e) => apply(e.nativeEvent.locationX),
    }),
  ).current;
  const frac = clamp((Math.log(mult) - SENS_LOG_MIN) / (SENS_LOG_MAX - SENS_LOG_MIN), 0, 1);

  return (
    <View style={styles.sensWrap}>
      <View style={styles.sensTitleRow}>
        <Text style={styles.ctrlTitle}>SENSITIVITY</Text>
        <Text style={styles.readout}>{mult < 1 ? mult.toFixed(2) : mult.toFixed(1)}×</Text>
      </View>
      <View style={[styles.sTrack, { width: W }]} {...pan.panHandlers}>
        <View style={styles.sBar} />
        <View style={[styles.sFill, { width: frac * W }]} />
        <View style={[styles.sThumb, { left: clamp(frac * W - 11, 0, W - 22) }]} />
      </View>
      <View style={[styles.sEndsRow, { width: W }]}>
        <Text style={styles.sEnd}>Fine</Text>
        <Text style={styles.sEnd}>Fast</Text>
      </View>
    </View>
  );
}

export default function AlignSidebar({ arRef, onClose }: AlignSidebarProps) {
  // Live sensitivity multiplier (read at call-time via a ref so the stable handlers
  // always use the latest slider value without re-creating). Scales EVERY control:
  // MOVE / DEPTH / ROTATE / ROLL / SCALE / the 90°-180° quick-turns.
  const sensRef = useRef(SENS_DEFAULT);

  // ── Direct drivers of the native view (no host handlers reused) ──
  const move = useCallback(
    (d: V3) => {
      const s = sensRef.current;
      arRef.current?.nudge?.(d[0] * s, d[1] * s, d[2] * s);
    },
    [arRef],
  );
  const rotate = useCallback(
    (d: V3) => {
      const s = sensRef.current;
      arRef.current?.rotateModel?.(d[0] * s, d[1] * s, d[2] * s);
    },
    [arRef],
  );
  const quickRotate = useCallback(
    (deg: number) => arRef.current?.rotateModel?.(0, deg * sensRef.current, 0),
    [arRef],
  );
  const scaleBy = useCallback((factor: number) => arRef.current?.scaleModel?.(factor), [arRef]);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.headerText}>ALIGN</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollBody}>
          {/* SENSITIVITY — scales every motion step below (calmer touch response). */}
          <SensSlider initial={SENS_DEFAULT} onChange={(m) => (sensRef.current = m)} />

          {/* MOVE — translate in screen space (Up/Down = height, Left/Right). */}
          <FourWayPad
            title="MOVE"
            upGlyph="▲"
            downGlyph="▼"
            leftGlyph="◀"
            rightGlyph="▶"
            upCap="Up"
            downCap="Down"
            leftCap="Left"
            rightCap="Right"
            onUp={() => move([0, POS_STEP, 0])}
            onDown={() => move([0, -POS_STEP, 0])}
            onLeft={() => move([-POS_STEP, 0, 0])}
            onRight={() => move([POS_STEP, 0, 0])}
          />

          {/* DEPTH — FRONT/BACK press-and-hold. */}
          <DepthButtons onFront={() => move([0, 0, DEPTH_STEP])} onBack={() => move([0, 0, -DEPTH_STEP])} />

          {/* ROTATE — pitch (up/down) + yaw (left/right). */}
          <FourWayPad
            title="ROTATE"
            upGlyph="▲"
            downGlyph="▼"
            leftGlyph="◀"
            rightGlyph="▶"
            upCap="Pitch ↑"
            downCap="Pitch ↓"
            leftCap="Yaw ←"
            rightCap="Yaw →"
            onUp={() => rotate([ROT_STEP, 0, 0])}
            onDown={() => rotate([-ROT_STEP, 0, 0])}
            onLeft={() => rotate([0, ROT_STEP, 0])}
            onRight={() => rotate([0, -ROT_STEP, 0])}
            accentVert="#E5392F"
            accentHoriz="#22A447"
          />

          {/* ROLL dial (self-centring) + SCALE buttons. */}
          <RollDial onRoll={(d) => rotate([0, 0, d])} />
          <ScaleButtons onScaleBy={scaleBy} sensRef={sensRef} />

          {/* Quick yaw rotate (also scaled by sensitivity). */}
          <View style={styles.ctrlBlock}>
            <Text style={styles.ctrlTitle}>QUICK TURN</Text>
            <View style={styles.quickRow}>
              <TouchableOpacity style={styles.quickBtn} onPress={() => quickRotate(90)} activeOpacity={0.7}>
                <Text style={styles.quickGlyph}>↻</Text>
                <Text style={styles.quickCap}>90°</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickBtn} onPress={() => quickRotate(180)} activeOpacity={0.7}>
                <Text style={styles.quickGlyph}>⟳</Text>
                <Text style={styles.quickCap}>180°</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const PANEL_W = 196;

const styles = StyleSheet.create({
  // Outer wrapper: box-none so taps outside the panel still reach the AR view
  // (drag-to-move keeps working). Docked on the LEFT (the toolbar owns the right).
  wrap: { position: 'absolute', left: 0, top: 70, bottom: 12, justifyContent: 'flex-start', zIndex: 30 },
  panel: {
    width: PANEL_W,
    maxHeight: '100%',
    marginLeft: 8,
    backgroundColor: 'rgba(13, 17, 23, 0.9)',
    borderRadius: 18,
    paddingBottom: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  headerText: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 1.5 },
  closeBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  scrollBody: { alignItems: 'center', paddingBottom: 8, gap: 12 },

  ctrlBlock: { alignItems: 'center', gap: 6 },
  ctrlTitle: { color: 'rgba(255,255,255,0.62)', fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  // SENSITIVITY slider
  sensWrap: { alignItems: 'center', gap: 5, paddingTop: 2 },
  sensTitleRow: { width: 150, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sTrack: { height: 30, justifyContent: 'center' },
  sBar: { position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)' },
  sFill: { position: 'absolute', left: 0, height: 6, borderRadius: 3, backgroundColor: 'rgba(14, 165, 233, 0.95)' },
  sThumb: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', borderWidth: 2, borderColor: 'rgba(14,165,233,0.95)' },
  sEndsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sEnd: { color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: '800' },

  // 4-way pad
  padRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  padSpacer: { width: 50, height: 2 },
  padHub: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)' },
  pad: {
    width: 50,
    height: 46,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  padGlyph: { color: '#0f172a', fontSize: 18, fontWeight: '800', lineHeight: 20 },
  padCaption: { color: '#334155', fontSize: 8, fontWeight: '700', marginTop: 1 },

  // ROLL dial
  dial: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 3,
    borderColor: 'rgba(31, 143, 229, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialIndicator: { ...StyleSheet.absoluteFillObject, alignItems: 'center' },
  dialTick: { width: 3, height: 22, borderRadius: 2, backgroundColor: '#1F8FE5', marginTop: 4 },
  dialDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1F8FE5', marginTop: -3 },
  dialGlyph: { color: 'rgba(255,255,255,0.75)', fontSize: 22, fontWeight: '800' },

  // SCALE buttons (− readout +)
  scaleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scaleBtn: { width: 56 },
  scaleReadout: { minWidth: 52, alignItems: 'center', justifyContent: 'center' },
  scaleReadoutText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  // FRONT/BACK depth buttons
  depthRow: { flexDirection: 'row', gap: 10 },
  depthBtn: { width: 76 },

  readout: { color: '#fff', fontSize: 13, fontWeight: '800' },

  // Quick turn
  quickRow: { flexDirection: 'row', gap: 10 },
  quickBtn: {
    width: 64,
    height: 50,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickGlyph: { color: '#0f172a', fontSize: 18, fontWeight: '800' },
  quickCap: { color: '#334155', fontSize: 10, fontWeight: '800' },
});
