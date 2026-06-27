// AR "Color" tab — paint the SOLID model by Profile / Grade (or none) with a
// legend, AND a see-through OPACITY control for inspecting through the surface.
// Mirrors EdgesPanel's docked dark bar (same section titles, big touch targets,
// translucent option). Reuses the SAME buildColorBy()/legend the web portal + the
// 3D viewer use, so the colours + buckets match across surfaces.
//
// Colour-by applies to the solid model only (the edge view is one flat colour),
// so the host forces Solid when a mode is picked. Opacity works regardless of the
// colour mode — it's the "see through the assembly surface" inspection control.
// Pure RN (no native deps).
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import PanelSlider from './PanelSlider';
import { RenderMode } from './types';
import { ColorBy, LegendEntry } from '../../projects/partviewer/viewerTools';

interface ColorByPanelProps {
  colorBy: ColorBy;
  legend: LegendEntry[];
  onColorBy: (by: ColorBy) => void;
  /** Model render opacity, 1 = solid. Lower = see through the surface. */
  opacity: number;
  onOpacity: (v: number) => void;
  /** View mode (Solid = fill only; Edges = filled + crisp outlines on top). */
  renderMode: RenderMode;
  onSelectView: (mode: RenderMode) => void;
  /** True while the edge overlay GLB is being generated. */
  edgesBusy?: boolean;
  bottomOffset?: number;
  translucent?: boolean;
}

const VIEW_OPTIONS: { mode: RenderMode; glyph: string; caption: string }[] = [
  { mode: 'solid', glyph: '■', caption: 'Solid' },
  { mode: 'wireframe', glyph: '◰', caption: 'Edges' },
];

const MODES: { by: ColorBy; glyph: string; caption: string }[] = [
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
const OPACITY_W = 3 * 46 + 2 * 6; // matches the 3-preset row so they line up

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export default function ColorByPanel({
  colorBy,
  legend,
  onColorBy,
  opacity,
  onOpacity,
  renderMode,
  onSelectView,
  edgesBusy = false,
  bottomOffset = 148,
  translucent = false,
}: ColorByPanelProps) {
  return (
    <View style={[styles.panel, { bottom: bottomOffset }]} pointerEvents="box-none">
      <View style={[styles.bar, translucent && styles.barTranslucent]}>
        {/* ── VIEW: Solid / Edges (both show the colour-by fill; Edges adds outlines) ── */}
        <Section title="VIEW">
          <View style={styles.row}>
            {VIEW_OPTIONS.map((opt) => {
              const active = renderMode === opt.mode;
              const showBusy = opt.mode === 'wireframe' && edgesBusy;
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
                  <Text style={[styles.btnCaption, active && styles.btnCaptionActive]}>{opt.caption}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Section>

        <View style={styles.divider} />

        {/* ── COLOUR BY: None / Profile / Grade ── */}
        <Section title="COLOUR BY">
          <View style={styles.row}>
            {MODES.map((m) => {
              const active = colorBy === m.by;
              return (
                <TouchableOpacity
                  key={m.by}
                  style={[styles.btn, active && styles.btnActive]}
                  onPress={() => onColorBy(m.by)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.btnGlyph, active && styles.btnGlyphActive]}>{m.glyph}</Text>
                  <Text style={[styles.btnCaption, active && styles.btnCaptionActive]}>{m.caption}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Section>

        <View style={styles.divider} />

        {/* ── OPACITY: see through the surface for inspection ── */}
        <Section title="OPACITY">
          <View style={styles.opacityBody}>
            <View style={styles.presetRow}>
              {OPACITY_PRESETS.map((p) => {
                const active = Math.abs(opacity - p.value) < 0.02;
                return (
                  <TouchableOpacity
                    key={p.label}
                    style={[styles.presetBtn, active && styles.presetBtnActive]}
                    onPress={() => onOpacity(p.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.presetText, active && styles.presetTextActive]}>{p.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <PanelSlider
              value={opacity}
              min={OPACITY_MIN}
              max={1}
              width={OPACITY_W}
              onComplete={onOpacity}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
          </View>
        </Section>

        {colorBy !== 'none' && (
          <>
            <View style={styles.divider} />
            {/* ── LEGEND: category → swatch + member count ── */}
            <Section title={`BY ${colorBy.toUpperCase()}`}>
              {legend.length === 0 ? (
                <Text style={styles.empty}>No {colorBy} data on these members.</Text>
              ) : (
                <ScrollView style={styles.legendScroll} showsVerticalScrollIndicator={false}>
                  {legend.map((e) => (
                    <View key={e.label} style={styles.legendRow}>
                      <View style={[styles.swatch, { backgroundColor: e.hex }]} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 0, right: 0, bottom: 148, alignItems: 'center', zIndex: 22 },
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
  sectionTitle: { color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  sectionBody: { alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
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
  // Opacity: a compact preset row above the fine slider (both OPACITY_W wide).
  opacityBody: { alignItems: 'center', gap: 8, width: OPACITY_W },
  presetRow: { flexDirection: 'row', gap: 6 },
  presetBtn: {
    width: 46,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetBtnActive: { backgroundColor: 'rgba(14, 165, 233, 0.95)' },
  presetText: { color: '#334155', fontSize: 12, fontWeight: '800' },
  presetTextActive: { color: '#ffffff' },
  legendScroll: { maxHeight: 150, minWidth: 190 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  swatch: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  legendLabel: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  legendCount: { color: '#94a3b8', fontSize: 12, fontWeight: '700', marginLeft: 'auto' },
  empty: { color: '#94a3b8', fontSize: 12, maxWidth: 170, textAlign: 'center' },
});
