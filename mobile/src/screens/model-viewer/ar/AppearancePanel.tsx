// AppearancePanel — the single "Display" tab, merging the old Edges + Color tabs.
//
// The two panels used to overlap badly: each carried its own "VIEW: Solid/Edges"
// control, and "Edges → COLOUR" (the edge LINE colour) read identically to
// "Color → COLOUR BY" (paint the SOLID by profile/grade). This panel collapses
// both into ONE coherent mental model with two concepts:
//
//   • SURFACE — how the solid body looks: Colour-by (None/Profile/Grade) +
//     See-through (opacity). The "fill".
//   • EDGES   — the outline overlay: a single Show-edges switch + its colour +
//     line weight. The "lines". (The duplicated Solid/Edges segmented control is
//     gone — the solid is always rendered, so edges is just an on/off overlay.)
//
//   • LEGEND  — category → swatch + count, explaining the active Colour-by.
//
// The SURFACE sections are OPTIONAL (driven by the colour-by / opacity props), so
// the Viro experience — which has no per-mesh colour overlay or opacity — passes
// only the edge props and the panel degrades to just the EDGES section. The
// RealityKit (LiDAR) experience passes everything for the full merged tab.
//
// Mirrors the other docked panels exactly (same dark bar, section titles, big
// touch targets, translucent option, sky-blue active state). Pure RN (no native
// deps); reuses the SAME buildColorBy()/legend the web portal + 3D viewer use, so
// the colours + buckets match across every surface.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import PanelSlider from './PanelSlider';
import { RenderMode, EDGE_COLORS, EDGE_WEIGHT_MIN, EDGE_WEIGHT_MAX } from './types';
import { ColorBy, LegendEntry } from '../../projects/partviewer/viewerTools';

interface AppearancePanelProps {
  // ── EDGES (always) ──
  renderMode: RenderMode;
  /** Toggle the edge overlay on/off. Hosts pass their existing handleSelectView. */
  onSelectView: (mode: RenderMode) => void;
  /** Live edge LINE colour (instant material swap on LiDAR; rebuild on Viro). */
  edgeColor: string;
  /** Line thickness multiplier (baked into the tube radius); driven by the slider. */
  edgeWeight: number;
  /** True while an edge GLB is being generated. */
  edgesBusy?: boolean;
  onSelectColor: (hex: string) => void;
  /** Commit a thickness (slider release) — rebuilds the edge view at that weight. */
  onCommitWeight: (weight: number) => void;

  // ── SURFACE (optional — only the engines that support it pass these) ──
  /** Whether per-mesh node data exists to colour by (profile/grade). */
  colorByAvailable?: boolean;
  colorBy?: ColorBy;
  legend?: LegendEntry[];
  onColorBy?: (by: ColorBy) => void;
  /** Model render opacity, 1 = solid. Lower = see through the surface. */
  opacity?: number;
  onOpacity?: (v: number) => void;

  // ── Layout ──
  bottomOffset?: number;
  translucent?: boolean;
}

const COLOR_BY_MODES: { by: ColorBy; glyph: string; caption: string }[] = [
  { by: 'none', glyph: '◻', caption: 'None' },
  { by: 'profile', glyph: 'I', caption: 'Profile' },
  { by: 'grade', glyph: '#', caption: 'Grade' },
];

// Quick opacity levels (instant on tap); the slider underneath fine-tunes.
const OPACITY_PRESETS: { label: string; value: number }[] = [
  { label: 'Solid', value: 1 },
  { label: '50%', value: 0.5 },
  { label: '25%', value: 0.25 },
];
const OPACITY_MIN = 0.15;
const OPACITY_W = 3 * 50 + 2 * 6; // matches the 3-preset row so they line up

// EDGES section: the Show-edges switch + a compact 4-per-row colour grid, sized
// to a fixed body width so the grid lines up under the switch.
const EDGE_SWATCH_W = 38;
const EDGE_COL_GAP = 6;
const EDGE_BODY_W = 4 * EDGE_SWATCH_W + 3 * EDGE_COL_GAP; // 170

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export default function AppearancePanel({
  renderMode,
  onSelectView,
  edgeColor,
  edgeWeight,
  edgesBusy = false,
  onSelectColor,
  onCommitWeight,
  colorByAvailable = false,
  colorBy = 'none',
  legend = [],
  onColorBy,
  opacity,
  onOpacity,
  bottomOffset = 148,
  translucent = false,
}: AppearancePanelProps) {
  const edgesOn = renderMode === 'wireframe';
  const showColorBy = !!onColorBy && colorByAvailable;
  const showOpacity = typeof opacity === 'number' && !!onOpacity;
  const showLegend = showColorBy && colorBy !== 'none';

  return (
    <View style={[styles.panel, { bottom: bottomOffset }]} pointerEvents="box-none">
      {/* Horizontal scroll so the wider merged bar never clips on a narrow device;
          centred while it fits, scrollable when it doesn't. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={[styles.bar, translucent && styles.barTranslucent]}>
        {/* ── SURFACE: COLOUR BY with SEE-THROUGH stacked directly BELOW it ── */}
        {(showColorBy || showOpacity) && (
          <>
            <View style={styles.surfaceColumn}>
              {showColorBy && (
                <Section title="COLOUR BY">
                  <View style={styles.row}>
                    {COLOR_BY_MODES.map((m) => {
                      const active = colorBy === m.by;
                      return (
                        <TouchableOpacity
                          key={m.by}
                          style={[styles.btn, active && styles.btnActive]}
                          onPress={() => onColorBy!(m.by)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.btnGlyph, active && styles.btnGlyphActive]}>{m.glyph}</Text>
                          <Text style={[styles.btnCaption, active && styles.btnCaptionActive]}>{m.caption}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </Section>
              )}
              {showOpacity && (
                <Section title="SEE-THROUGH">
                  <View style={styles.opacityBody}>
                    <View style={styles.presetRow}>
                      {OPACITY_PRESETS.map((p) => {
                        const active = Math.abs((opacity as number) - p.value) < 0.02;
                        return (
                          <TouchableOpacity
                            key={p.label}
                            style={[styles.presetBtn, active && styles.presetBtnActive]}
                            onPress={() => onOpacity!(p.value)}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.presetText, active && styles.presetTextActive]}>{p.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <PanelSlider
                      value={opacity as number}
                      min={OPACITY_MIN}
                      max={1}
                      width={OPACITY_W}
                      onComplete={onOpacity!}
                      formatValue={(v) => `${Math.round(v * 100)}%`}
                    />
                  </View>
                </Section>
              )}
            </View>
            <View style={styles.divider} />
          </>
        )}

        {/* ── EDGES: a single Show-edges switch + its colour + line weight ── */}
        <Section title="EDGES">
          <View style={styles.edgeBody}>
            {/* Show-edges switch (replaces the old Solid/Edges segmented control) */}
            <TouchableOpacity
              style={[styles.switchRow, edgesOn && styles.switchRowOn]}
              onPress={() => onSelectView(edgesOn ? 'solid' : 'wireframe')}
              activeOpacity={0.8}
            >
              <Text style={[styles.switchLabel, edgesOn && styles.switchLabelOn]}>Show edges</Text>
              <View style={[styles.switchTrack, edgesOn && styles.switchTrackOn]}>
                {edgesBusy ? (
                  <ActivityIndicator size="small" color={edgesOn ? '#ffffff' : '#0f172a'} />
                ) : (
                  <View style={[styles.switchKnob, edgesOn && styles.switchKnobOn]} />
                )}
              </View>
            </TouchableOpacity>

            {/* Colour: 4-per-row swatch grid (edge view only) */}
            <Text style={[styles.subLabel, !edgesOn && styles.disabledText]}>Colour</Text>
            <View style={[styles.swatchGrid, !edgesOn && styles.disabled]}>
              {EDGE_COLORS.map((c) => {
                const active = edgeColor === c.hex;
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.edgeSwatch, { backgroundColor: c.hex }, active && styles.edgeSwatchActive]}
                    onPress={() => edgesOn && onSelectColor(c.hex)}
                    disabled={!edgesOn}
                    activeOpacity={0.7}
                  >
                    {active && <Text style={styles.edgeSwatchCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Thickness: a free slider (edge view only) — no discrete presets. */}
            <Text style={[styles.subLabel, !edgesOn && styles.disabledText]}>Thickness</Text>
            <PanelSlider
              value={edgeWeight}
              min={EDGE_WEIGHT_MIN}
              max={EDGE_WEIGHT_MAX}
              disabled={!edgesOn}
              width={EDGE_BODY_W}
              onComplete={onCommitWeight}
              formatValue={(v) => `${v.toFixed(2)}×`}
            />
          </View>
        </Section>

        {/* ── LEGEND: category → swatch + member count ── */}
        {showLegend && (
          <>
            <View style={styles.divider} />
            <Section title={`BY ${colorBy.toUpperCase()}`}>
              {legend.length === 0 ? (
                <Text style={styles.empty}>No {colorBy} data on these members.</Text>
              ) : (
                <ScrollView style={styles.legendScroll} showsVerticalScrollIndicator={false}>
                  {legend.map((e) => (
                    <View key={e.label} style={styles.legendRow}>
                      <View style={[styles.legendSwatch, { backgroundColor: e.hex }]} />
                      <Text style={styles.legendLabel} numberOfLines={1}>{e.label}</Text>
                      <Text style={styles.legendCount}>×{e.count}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}
            </Section>
          </>
        )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 0, right: 0, bottom: 148, zIndex: 22 },
  // Full-width scroller; centres the bar while it fits, scrolls when it overflows.
  scroll: { flexGrow: 0 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'flex-start', paddingHorizontal: 8 },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 18,
    backgroundColor: 'rgba(13, 17, 23, 0.92)',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 18,
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
  // SURFACE column: COLOUR BY on top, SEE-THROUGH stacked beneath it.
  surfaceColumn: { flexDirection: 'column', alignItems: 'center', gap: 16 },
  row: { flexDirection: 'row', gap: 8 },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.14)' },
  disabled: { opacity: 0.35 },
  disabledText: { opacity: 0.45 },

  // COLOUR BY buttons (shared big-touch-target style).
  btn: {
    width: 60,
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

  // SEE-THROUGH: a compact preset row above the fine slider (both OPACITY_W wide).
  opacityBody: { alignItems: 'center', gap: 8, width: OPACITY_W },
  presetRow: { flexDirection: 'row', gap: 6 },
  presetBtn: {
    width: 50,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetBtnActive: { backgroundColor: 'rgba(14, 165, 233, 0.95)' },
  presetText: { color: '#334155', fontSize: 12, fontWeight: '800' },
  presetTextActive: { color: '#ffffff' },

  // EDGES: switch + colour grid + weight, all EDGE_BODY_W wide so they align.
  edgeBody: { alignItems: 'center', gap: 8, width: EDGE_BODY_W },
  subLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '700', alignSelf: 'flex-start' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: EDGE_BODY_W,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  switchRowOn: { backgroundColor: 'rgba(14, 165, 233, 0.22)' },
  switchLabel: { color: '#cbd5e1', fontSize: 14, fontWeight: '800' },
  switchLabelOn: { color: '#ffffff' },
  switchTrack: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.25)',
    padding: 3,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  switchTrackOn: { backgroundColor: 'rgba(14, 165, 233, 0.95)', alignItems: 'flex-end' },
  switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#e2e8f0' },
  switchKnobOn: { backgroundColor: '#ffffff' },
  // 4-per-row edge-colour grid (8 colours → 2 rows).
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: EDGE_BODY_W,
    gap: EDGE_COL_GAP,
  },
  edgeSwatch: {
    width: EDGE_SWATCH_W,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  edgeSwatchActive: { borderColor: '#ffffff', borderWidth: 3 },
  edgeSwatchCheck: {
    color: '#0b1220',
    fontSize: 14,
    fontWeight: '900',
    textShadowColor: 'rgba(255,255,255,0.8)',
    textShadowRadius: 2,
  },

  // LEGEND
  legendScroll: { maxHeight: 168, minWidth: 190 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  legendSwatch: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  legendLabel: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  legendCount: { color: '#94a3b8', fontSize: 12, fontWeight: '700', marginLeft: 'auto' },
  empty: { color: '#94a3b8', fontSize: 12, maxWidth: 170, textAlign: 'center' },
});
