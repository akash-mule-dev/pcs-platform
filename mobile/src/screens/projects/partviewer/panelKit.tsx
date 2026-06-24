// Shared building blocks for the 3D Viewer tool panels — mirrors the AR viewer's
// docked-panel look (dark rounded bar, uppercase section titles, pill chips) so
// the two viewers feel like one product.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export function Chip({
  label,
  glyph,
  active,
  disabled,
  onPress,
}: {
  label: string;
  glyph?: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      {glyph ? <Text style={[styles.chipGlyph, active && styles.chipTextActive]}>{glyph}</Text> : null}
      <Text style={[styles.chipLabel, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export const styles = StyleSheet.create({
  // The docked bar floats clearly ABOVE the toolbar tabs (~113px tall) with a gap.
  panel: { position: 'absolute', left: 0, right: 0, bottom: 142, alignItems: 'center', zIndex: 22 },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 18,
    backgroundColor: 'rgba(13, 17, 23, 0.94)',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 18,
    maxWidth: '96%',
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
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.14)' },
  disabled: { opacity: 0.35 },
  chip: {
    minWidth: 56,
    height: 46,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: 'rgba(14, 165, 233, 0.95)' },
  chipGlyph: { color: '#0f172a', fontSize: 18, fontWeight: '800', lineHeight: 20 },
  chipLabel: { color: '#334155', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#ffffff' },
});
