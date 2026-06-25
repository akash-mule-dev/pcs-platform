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
import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Vec3 } from './types';

const POS_STEP = 0.004; // metres per tick
const ROT_STEP = 1; // degrees per tick
const SCALE_STEP = 1.03; // multiplier per tick
const TICK_MS = 40;

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
}

/** A button that fires `onHold` once on press and then repeats while held. */
function HoldButton({
  glyph,
  caption,
  onHold,
  locked,
  repeat = true,
  wide = false,
}: {
  glyph: string;
  caption: string;
  onHold: () => void;
  locked: boolean;
  repeat?: boolean;
  wide?: boolean;
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
      style={[styles.btn, wide && styles.btnWide, locked && styles.btnDisabled]}
      onPressIn={start}
      onPressOut={stop}
      disabled={locked}
      activeOpacity={0.6}
    >
      <Text style={styles.btnGlyph}>{glyph}</Text>
      <Text style={styles.btnCaption}>{caption}</Text>
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
}: AlignPanelProps) {
  const scaleLabel = `${(scale[0] ?? 1).toFixed(2)}×`;

  return (
    <View style={[styles.panel, { bottom: bottomOffset }]} pointerEvents="box-none">
      <View style={[styles.bar, translucent && styles.barTranslucent]}>
        {/* When locked the transform can't change, so the move/rotate/scale
            controls are hidden — only the unlock control remains. */}
        {!locked && (
          <>
            {/* ── MOVE: X (left/right), Y (up/down), Z (near/far depth) ── */}
            <Section title="MOVE">
              <View style={styles.grid}>
                <HoldButton glyph="◀" caption="Left" locked={locked} onHold={() => onNudgePosition([-POS_STEP, 0, 0])} />
                <HoldButton glyph="▲" caption="Up" locked={locked} onHold={() => onNudgePosition([0, POS_STEP, 0])} />
                <HoldButton glyph="▶" caption="Right" locked={locked} onHold={() => onNudgePosition([POS_STEP, 0, 0])} />
                <HoldButton glyph="⊕" caption="Near" locked={locked} onHold={() => onNudgePosition([0, 0, POS_STEP])} />
                <HoldButton glyph="▼" caption="Down" locked={locked} onHold={() => onNudgePosition([0, -POS_STEP, 0])} />
                <HoldButton glyph="⊖" caption="Far" locked={locked} onHold={() => onNudgePosition([0, 0, -POS_STEP])} />
              </View>
            </Section>

            <View style={styles.divider} />

            {/* ── ROTATE: pitch (X), yaw (Y), roll (Z) + quick-rotate ── */}
            <Section title="ROTATE">
              <View style={styles.grid}>
                <HoldButton glyph="⤢" caption="Pitch+" locked={locked} onHold={() => onNudgeRotation([ROT_STEP, 0, 0])} />
                <HoldButton glyph="↺" caption="Yaw+" locked={locked} onHold={() => onNudgeRotation([0, ROT_STEP, 0])} />
                <HoldButton glyph="⟲" caption="Roll+" locked={locked} onHold={() => onNudgeRotation([0, 0, ROT_STEP])} />
                <HoldButton glyph="⤡" caption="Pitch−" locked={locked} onHold={() => onNudgeRotation([-ROT_STEP, 0, 0])} />
                <HoldButton glyph="↻" caption="Yaw−" locked={locked} onHold={() => onNudgeRotation([0, -ROT_STEP, 0])} />
                <HoldButton glyph="⟳" caption="Roll−" locked={locked} onHold={() => onNudgeRotation([0, 0, -ROT_STEP])} />
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
                <HoldButton glyph="−" caption="Smaller" locked={locked} onHold={() => onScaleBy(1 / SCALE_STEP)} />
                <View style={styles.scaleReadout}>
                  <Text style={styles.scaleReadoutText}>{scaleLabel}</Text>
                </View>
                <HoldButton glyph="+" caption="Bigger" locked={locked} onHold={() => onScaleBy(SCALE_STEP)} />
              </View>
            </Section>

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
