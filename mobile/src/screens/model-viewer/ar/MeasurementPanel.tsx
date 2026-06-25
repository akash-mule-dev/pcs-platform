// Consolidated AR measurement panel — the "Measure" tab.
//
// Mirrors AlignPanel / EdgesPanel exactly (same docked dark bar, section titles,
// big touch targets) so all three tabs feel identical. Three sections:
//   • DIMENSIONS — show/hide the passive size overlays (Overall W×H×D box,
//                  per-part longest-edge labels). Independent toggles.
//   • MEASURE    — the tap-to-measure tools, ONE active at a time: a ruler on the
//                  model, a ruler in the real world, or a model↔real deviation
//                  probe. Tapping the active tool again turns it off.
//   • RESULT     — a live readout of the active tool (distance, Δ, or a tap hint)
//                  plus Clear, and Log QA when a deviation has been captured.
//
// The scene's tap handling, the 3D overlays and MeasurementState are unchanged —
// this is purely the control surface. Pure RN (no native deps).
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MeasurementState, Vec3, LABEL_SIZE_MIN, LABEL_SIZE_MAX } from './types';
import { ModelDimensions, formatMeters } from './dimensionExtractor';
import PanelSlider from './PanelSlider';

interface MeasurementPanelProps {
  measurements: MeasurementState;
  dimensions: ModelDimensions | null;
  /** The model node's autofit scale — model-ruler world distances divide by it. */
  modelScale: number;
  onChange: (patch: Partial<MeasurementState>) => void;
  onClearRulers: () => void;
  /** Log the current model↔real deviation as a QA measurement (out-of-tolerance auto-fails). */
  onLogDeviation?: () => void;
  /** Distance from the bottom edge (default clears the bottom toolbar). */
  bottomOffset?: number;
  /** Use a more see-through panel background (buttons unchanged). */
  translucent?: boolean;
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

type Tool = 'model' | 'real' | 'deviation';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Btn({
  glyph,
  caption,
  active,
  onPress,
}: {
  glyph: string;
  caption: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.btn, active && styles.btnActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.btnGlyph, active && styles.btnGlyphActive]}>{glyph}</Text>
      <Text style={[styles.btnCaption, active && styles.btnCaptionActive]}>{caption}</Text>
    </TouchableOpacity>
  );
}

export default function MeasurementPanel({
  measurements,
  dimensions,
  modelScale,
  onChange,
  onClearRulers,
  onLogDeviation,
  bottomOffset = 148,
  translucent = false,
}: MeasurementPanelProps) {
  const {
    showOverall,
    showParts,
    modelRulerActive,
    realRulerActive,
    deviationActive,
    modelRulerPoints,
    realRulerPoints,
    deviationModelPoint,
    deviationRealPoint,
    labelSize,
  } = measurements;

  const activeTool: Tool | null = modelRulerActive
    ? 'model'
    : realRulerActive
      ? 'real'
      : deviationActive
        ? 'deviation'
        : null;

  // Pick a tap tool (radio): turn the chosen one on and the others off, or turn
  // it off if it's already active. Switching always clears the deviation pair so
  // a stale probe never lingers.
  const selectTool = (tool: Tool) => {
    const turnOff = activeTool === tool;
    onChange({
      modelRulerActive: !turnOff && tool === 'model',
      realRulerActive: !turnOff && tool === 'real',
      deviationActive: !turnOff && tool === 'deviation',
      deviationModelPoint: null,
      deviationRealPoint: null,
    });
  };

  const deviationMeters =
    deviationModelPoint && deviationRealPoint
      ? dist(deviationModelPoint, deviationRealPoint)
      : null;

  const hasPoints =
    modelRulerPoints.length > 0 || realRulerPoints.length > 0 || deviationModelPoint != null;

  // ── Build the RESULT readout for whatever tool is active ──
  // `sizeLines` (idle) is the W/H/D box stacked one axis per line so each stays
  // big and legible; `readoutValue` (a tool is active) is a single short value
  // shown large. Never cram a long string into one shrunk-to-nothing line.
  let readoutLabel = 'Size';
  let readoutValue: string | null = null;
  let sizeLines: string[] | null = null;
  let hint: string | null = null;

  if (activeTool === 'model' || activeTool === 'real') {
    const pts = activeTool === 'model' ? modelRulerPoints : realRulerPoints;
    readoutLabel = activeTool === 'model' ? 'Model ruler' : 'Real ruler';
    if (pts.length === 2) {
      // Model-ruler taps hit the auto-fit-scaled model, so divide the world
      // distance by the model scale to read its true size (real ruler is already
      // world-true).
      const raw = dist(pts[0], pts[1]);
      readoutValue = formatMeters(activeTool === 'model' ? raw / (modelScale || 1) : raw);
    } else {
      readoutValue = `${pts.length}/2 pts`;
      hint =
        activeTool === 'model'
          ? 'Tap 2 points on the model'
          : 'Aim the reticle, tap Place (×2)';
    }
  } else if (activeTool === 'deviation') {
    readoutLabel = 'Deviation';
    if (deviationMeters != null) {
      readoutValue = `Δ ${formatMeters(deviationMeters)}`;
    } else if (deviationModelPoint) {
      readoutValue = '1/2 pts';
      hint = 'Aim the reticle at the real part, tap Place';
    } else {
      readoutValue = '0/2 pts';
      hint = 'Tap the model first';
    }
  } else if (dimensions) {
    const [w, h, d] = dimensions.overall.size;
    readoutLabel = 'Overall size';
    sizeLines = [`W  ${formatMeters(w)}`, `H  ${formatMeters(h)}`, `D  ${formatMeters(d)}`];
  } else {
    readoutValue = 'Analyzing…';
  }

  return (
    <View style={[styles.panel, { bottom: bottomOffset }]} pointerEvents="box-none">
      <View style={[styles.bar, translucent && styles.barTranslucent]}>
        {/* ── DIMENSIONS: passive size overlays + label-size slider ── */}
        <Section title="DIMENSIONS">
          <View style={styles.dimBody}>
            <View style={styles.row}>
              <Btn
                glyph="⬚"
                caption="Overall"
                active={showOverall}
                onPress={() => onChange({ showOverall: !showOverall })}
              />
              <Btn
                glyph="▦"
                caption="Parts"
                active={showParts}
                onPress={() => onChange({ showParts: !showParts })}
              />
            </View>
            <Text style={styles.subLabel}>Label size</Text>
            <PanelSlider
              value={labelSize}
              min={LABEL_SIZE_MIN}
              max={LABEL_SIZE_MAX}
              disabled={!showOverall && !showParts}
              width={2 * 68 + 8}
              onComplete={(v) => onChange({ labelSize: v })}
              formatValue={(v) => `${v.toFixed(1)}×`}
            />
          </View>
        </Section>

        <View style={styles.divider} />

        {/* ── MEASURE: tap tools (one active at a time) ── */}
        <Section title="MEASURE">
          <View style={styles.row}>
            <Btn glyph="△" caption="Model" active={activeTool === 'model'} onPress={() => selectTool('model')} />
            <Btn glyph="◎" caption="Real" active={activeTool === 'real'} onPress={() => selectTool('real')} />
            <Btn glyph="Δ" caption="Deviate" active={activeTool === 'deviation'} onPress={() => selectTool('deviation')} />
          </View>
        </Section>

        <View style={styles.divider} />

        {/* ── RESULT: live readout + clear + log ── */}
        <Section title="RESULT">
          <View style={styles.resultBody}>
            <View style={styles.readout}>
              <Text style={styles.readoutLabel}>{readoutLabel}</Text>
              {sizeLines ? (
                <View style={styles.sizeLines}>
                  {sizeLines.map((line) => (
                    <Text key={line} style={styles.sizeLine}>
                      {line}
                    </Text>
                  ))}
                </View>
              ) : (
                <Text
                  style={styles.readoutValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {readoutValue}
                </Text>
              )}
              {hint && <Text style={styles.readoutHint}>{hint}</Text>}
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.clearBtn, !hasPoints && styles.actionDisabled]}
                onPress={onClearRulers}
                disabled={!hasPoints}
                activeOpacity={0.8}
              >
                <Text style={styles.actionText}>Clear</Text>
              </TouchableOpacity>
              {deviationMeters != null && onLogDeviation && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.logBtn]}
                  onPress={onLogDeviation}
                  activeOpacity={0.8}
                >
                  <Text style={styles.actionText}>Log QA</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
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
    // Clears the toolbar (~129px) so the panel sits ABOVE the tabs.
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
  row: { flexDirection: 'row', gap: 8 },
  dimBody: { alignItems: 'center', gap: 8, width: 2 * 68 + 8 },
  subLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.14)' },
  btn: {
    width: 68,
    height: 64,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnActive: { backgroundColor: 'rgba(14, 165, 233, 0.95)' },
  btnGlyph: { color: '#0f172a', fontSize: 24, fontWeight: '800', lineHeight: 28 },
  btnGlyphActive: { color: '#ffffff' },
  btnCaption: { color: '#334155', fontSize: 11, fontWeight: '700', marginTop: 2 },
  btnCaptionActive: { color: '#ffffff' },
  // RESULT section: a wide readout box so values + units stay big and legible,
  // with the actions stacked under it.
  resultBody: { alignItems: 'stretch', gap: 8, width: 200 },
  readout: {
    minHeight: 78,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  readoutLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  readoutValue: { color: '#ffffff', fontSize: 26, fontWeight: '800', marginTop: 3 },
  sizeLines: { marginTop: 4, gap: 2 },
  sizeLine: { color: '#e2e8f0', fontSize: 15, fontWeight: '700', lineHeight: 19 },
  readoutHint: { color: '#facc15', fontSize: 11, fontWeight: '600', marginTop: 5, lineHeight: 14 },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtn: { backgroundColor: 'rgba(239, 68, 68, 0.92)' },
  logBtn: { backgroundColor: 'rgba(34, 211, 238, 0.92)' },
  actionDisabled: { opacity: 0.35 },
  actionText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
});
