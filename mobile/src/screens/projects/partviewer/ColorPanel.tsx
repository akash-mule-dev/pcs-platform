// "Color" tab — paint the model by Profile / Grade (or none), with a legend.
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Section, Chip, styles as kit } from './panelKit';
import { ColorBy, LegendEntry } from './viewerTools';

interface ColorPanelProps {
  colorBy: ColorBy;
  legend: LegendEntry[];
  onColorBy: (by: ColorBy) => void;
}

const MODES: { by: ColorBy; label: string }[] = [
  { by: 'none', label: 'None' },
  { by: 'profile', label: 'Profile' },
  { by: 'grade', label: 'Grade' },
];

export default function ColorPanel({ colorBy, legend, onColorBy }: ColorPanelProps) {
  return (
    <View style={kit.panel} pointerEvents="box-none">
      <View style={kit.bar}>
        <Section title="COLOUR BY">
          <View style={kit.row}>
            {MODES.map((m) => (
              <Chip key={m.by} label={m.label} active={colorBy === m.by} onPress={() => onColorBy(m.by)} />
            ))}
          </View>
        </Section>

        {colorBy !== 'none' && (
          <>
            <View style={kit.divider} />
            <Section title={`BY ${colorBy.toUpperCase()}`}>
              {legend.length === 0 ? (
                <Text style={local.empty}>No {colorBy} data on these members.</Text>
              ) : (
                <ScrollView style={local.legendScroll} showsVerticalScrollIndicator={false}>
                  {legend.map((e) => (
                    <View key={e.label} style={local.legendRow}>
                      <View style={[local.swatch, { backgroundColor: e.hex }]} />
                      <Text style={local.legendLabel} numberOfLines={1}>{e.label}</Text>
                      <Text style={local.legendCount}>×{e.count}</Text>
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

const local = StyleSheet.create({
  legendScroll: { maxHeight: 132, minWidth: 170 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  swatch: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  legendLabel: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  legendCount: { color: '#94a3b8', fontSize: 12, fontWeight: '700', marginLeft: 'auto' },
  empty: { color: '#94a3b8', fontSize: 12, maxWidth: 160, textAlign: 'center' },
});
