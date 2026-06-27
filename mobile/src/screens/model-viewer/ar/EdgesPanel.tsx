// Consolidated AR edge-view panel — the "Edges" tab.
//
// Mirrors AlignPanel / MeasurementPanel exactly (same docked dark bar, section
// titles, big touch targets). Three sections:
//   • VIEW   — Solid / Edges (picking Edges turns on the edge-tube overlay,
//              generating it on demand).
//   • COLOUR — the edge line colour (live material swap; instant, no rebuild).
//   • WEIGHT — line thickness: Thin / Medium / Thick presets PLUS a free slider
//              for any weight in between. Rebakes the tube radius (commit on
//              release / preset tap, not while dragging).
//
// COLOUR + WEIGHT only apply to the edge view, so they're dimmed/disabled until
// Edges is the active view. Pure RN (no native deps).
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import PanelSlider from './PanelSlider';
import {
  RenderMode,
  EDGE_COLORS,
  EDGE_WEIGHT_PRESETS,
  EDGE_WEIGHT_MIN,
  EDGE_WEIGHT_MAX,
} from './types';

interface EdgesPanelProps {
  renderMode: RenderMode;
  edgeColor: string;
  edgeWeight: number;
  /** True while an edge GLB is being generated. */
  busy: boolean;
  onSelectView: (mode: RenderMode) => void;
  onSelectColor: (hex: string) => void;
  /** Commit a weight (preset tap / slider release) — rebuilds the edge view. */
  onCommitWeight: (weight: number) => void;
  /** Distance from the bottom edge (default clears the bottom toolbar). */
  bottomOffset?: number;
  /** Use a more see-through panel background (buttons unchanged). */
  translucent?: boolean;
}

const VIEW_OPTIONS: { mode: RenderMode; glyph: string; caption: string }[] = [
  { mode: 'solid', glyph: '■', caption: 'Solid' },
  { mode: 'wireframe', glyph: '◰', caption: 'Edges' },
];

const WEIGHT_W = 3 * 68 + 2 * 8; // matches the other 3-button rows, so the slider aligns
// The weight presets are a 4-button row (Fine/Thin/Medium/Thick); size each so
// the row's total width equals WEIGHT_W (and thus the slider underneath).
const WEIGHT_BTN_W = Math.floor((WEIGHT_W - 3 * 8) / 4);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export default function EdgesPanel({
  renderMode,
  edgeColor,
  edgeWeight,
  busy,
  onSelectView,
  onSelectColor,
  onCommitWeight,
  bottomOffset = 148,
  translucent = false,
}: EdgesPanelProps) {
  const edgesActive = renderMode === 'wireframe';

  return (
    <View style={[styles.panel, { bottom: bottomOffset }]} pointerEvents="box-none">
      <View style={[styles.bar, translucent && styles.barTranslucent]}>
        {/* ── VIEW: Solid / Edges ── */}
        <Section title="VIEW">
          <View style={styles.row}>
            {VIEW_OPTIONS.map((opt) => {
              const active = renderMode === opt.mode;
              const showBusy = opt.mode === 'wireframe' && busy;
              return (
                <TouchableOpacity
                  key={opt.mode}
                  style={[styles.btn, active && styles.btnActive]}
                  onPress={() => onSelectView(opt.mode)}
                  activeOpacity={0.7}
                >
                  {showBusy ? (
                    <ActivityIndicator size="small" color={active ? '#ffffff' : '#0f172a'} />
                  ) : (
                    <Text style={[styles.btnGlyph, active && styles.btnGlyphActive]}>{opt.glyph}</Text>
                  )}
                  <Text style={[styles.btnCaption, active && styles.btnCaptionActive]}>
                    {opt.caption}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Section>

        <View style={styles.divider} />

        {/* ── COLOUR: live edge-material swap (edge view only) ── */}
        <Section title="COLOUR">
          <View style={[styles.swatchRow, !edgesActive && styles.disabled]}>
            {EDGE_COLORS.map((c) => {
              const active = edgeColor === c.hex;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.swatch, { backgroundColor: c.hex }, active && styles.swatchActive]}
                  onPress={() => edgesActive && onSelectColor(c.hex)}
                  disabled={!edgesActive}
                  activeOpacity={0.7}
                >
                  {active && <Text style={styles.swatchCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </Section>

        <View style={styles.divider} />

        {/* ── WEIGHT: Fine/Thin/Medium/Thick presets + free slider (rebakes radius) ── */}
        <Section title="WEIGHT">
          <View style={styles.weightBody}>
            <View style={[styles.row, !edgesActive && styles.disabled]}>
              {EDGE_WEIGHT_PRESETS.map((p) => {
                const active = Math.abs(edgeWeight - p.scale) < 0.01;
                return (
                  <TouchableOpacity
                    key={p.label}
                    style={[styles.btn, styles.weightBtn, active && styles.btnActive]}
                    onPress={() => edgesActive && onCommitWeight(p.scale)}
                    disabled={!edgesActive}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.weightSample,
                        { height: Math.max(2, Math.round(p.scale * 3)) },
                        active && styles.weightSampleActive,
                      ]}
                    />
                    <Text style={[styles.btnCaption, active && styles.btnCaptionActive]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <PanelSlider
              value={edgeWeight}
              min={EDGE_WEIGHT_MIN}
              max={EDGE_WEIGHT_MAX}
              disabled={!edgesActive}
              width={WEIGHT_W}
              onComplete={onCommitWeight}
              formatValue={(v) => `${v.toFixed(2)}×`}
            />
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
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.14)' },
  disabled: { opacity: 0.35 },
  btn: {
    width: 68,
    height: 64,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Weight presets are a 4-button row — narrower than the 68px VIEW buttons so
  // the four of them line up with the slider (WEIGHT_W) underneath.
  weightBtn: { width: WEIGHT_BTN_W },
  btnActive: { backgroundColor: 'rgba(14, 165, 233, 0.95)' },
  btnGlyph: { color: '#0f172a', fontSize: 24, fontWeight: '800', lineHeight: 28 },
  btnGlyphActive: { color: '#ffffff' },
  btnCaption: { color: '#334155', fontSize: 11, fontWeight: '700', marginTop: 2 },
  btnCaptionActive: { color: '#ffffff' },
  // Colour swatches: a 3×2 grid so the row width matches the 3-button sections.
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 3 * 64 + 2 * 8,
    justifyContent: 'center',
    gap: 8,
  },
  swatch: {
    width: 64,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  swatchActive: { borderColor: '#ffffff', borderWidth: 3 },
  swatchCheck: {
    color: '#0b1220',
    fontSize: 16,
    fontWeight: '900',
    textShadowColor: 'rgba(255,255,255,0.8)',
    textShadowRadius: 2,
  },
  // WEIGHT: presets show a line of proportional thickness; the slider + readout
  // sit under them, all WEIGHT_W wide so everything lines up.
  weightBody: { alignItems: 'center', gap: 8, width: WEIGHT_W },
  weightSample: {
    width: 30,
    borderRadius: 2,
    backgroundColor: '#0f172a',
  },
  weightSampleActive: { backgroundColor: '#ffffff' },
});
