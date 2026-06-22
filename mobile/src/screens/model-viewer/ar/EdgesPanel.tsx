// Consolidated AR edge-view panel — the "Edges" tab.
//
// Mirrors AlignPanel exactly (same docked dark bar, section titles, big touch
// targets) so the two tabs feel identical. Three sections:
//   • VIEW   — Solid / Ghost / Edges (the model's appearance; picking Edges turns
//              on the edge-tube overlay, generating it on demand).
//   • COLOUR — the edge line colour (live material swap; instant, no rebuild).
//   • WEIGHT — Thin / Medium / Thick edge line weight (rebakes the tube radius).
//
// COLOUR + WEIGHT only apply to the edge view, so they're dimmed/disabled until
// Edges is the active view. Pure RN (no native deps); every change is reported
// up via callbacks which the host applies to model state.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { RenderMode, EdgeThickness, EDGE_COLORS } from './types';

interface EdgesPanelProps {
  renderMode: RenderMode;
  edgeColor: string;
  edgeThickness: EdgeThickness;
  /** True while an edge GLB is being generated. */
  busy: boolean;
  onSelectView: (mode: RenderMode) => void;
  onSelectColor: (hex: string) => void;
  onSelectThickness: (thickness: EdgeThickness) => void;
}

const VIEW_OPTIONS: { mode: RenderMode; glyph: string; caption: string }[] = [
  { mode: 'solid', glyph: '■', caption: 'Solid' },
  { mode: 'ghost', glyph: '◫', caption: 'Ghost' },
  { mode: 'wireframe', glyph: '◰', caption: 'Edges' },
];

const THICKNESS_OPTIONS: { value: EdgeThickness; glyph: string; caption: string }[] = [
  { value: 'thin', glyph: '│', caption: 'Thin' },
  { value: 'medium', glyph: '┃', caption: 'Medium' },
  { value: 'thick', glyph: '█', caption: 'Thick' },
];

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
  edgeThickness,
  busy,
  onSelectView,
  onSelectColor,
  onSelectThickness,
}: EdgesPanelProps) {
  const edgesActive = renderMode === 'wireframe';

  return (
    <View style={styles.panel} pointerEvents="box-none">
      <View style={styles.bar}>
        {/* ── VIEW: Solid / Ghost / Edges ── */}
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
                  style={[
                    styles.swatch,
                    { backgroundColor: c.hex },
                    active && styles.swatchActive,
                  ]}
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

        {/* ── WEIGHT: Thin / Medium / Thick (rebakes the tube radius) ── */}
        <Section title="WEIGHT">
          <View style={[styles.row, !edgesActive && styles.disabled]}>
            {THICKNESS_OPTIONS.map((opt) => {
              const active = edgeThickness === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.btn, active && styles.btnActive]}
                  onPress={() => edgesActive && onSelectThickness(opt.value)}
                  disabled={!edgesActive}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.btnGlyph, active && styles.btnGlyphActive]}>{opt.glyph}</Text>
                  <Text style={[styles.btnCaption, active && styles.btnCaptionActive]}>
                    {opt.caption}
                  </Text>
                </TouchableOpacity>
              );
            })}
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
    bottom: 96,
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
  btnActive: { backgroundColor: 'rgba(14, 165, 233, 0.95)' },
  btnGlyph: { color: '#0f172a', fontSize: 24, fontWeight: '800', lineHeight: 28 },
  btnGlyphActive: { color: '#ffffff' },
  btnCaption: { color: '#334155', fontSize: 11, fontWeight: '700', marginTop: 2 },
  btnCaptionActive: { color: '#ffffff' },
  // Colour swatches: a 3×2 grid so the row stays the same width as the 3-button
  // sections (matching AlignPanel's MOVE/ROTATE grid feel).
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
});
