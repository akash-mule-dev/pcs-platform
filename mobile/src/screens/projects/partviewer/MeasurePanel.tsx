// "Measure" tab — point-to-point distance + bounding-box dimensions, in real mm.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Section, Chip, styles as kit } from './panelKit';
import { formatMm } from './viewerTools';

interface MeasurePanelProps {
  distanceOn: boolean;
  dimensionsOn: boolean;
  /** Live ruler readout from the viewer (null = no completed measurement). */
  distance: { mm: number | null; calibrated: boolean } | null;
  /** Bounding-box dimensions from the viewer. */
  dims: { l: number; h: number; d: number; calibrated: boolean } | null;
  /** Whether the model's unit scale could be calibrated to mm at all. */
  calibrated: boolean;
  onToggleDistance: () => void;
  onToggleDimensions: () => void;
  onClear: () => void;
}

export default function MeasurePanel({
  distanceOn,
  dimensionsOn,
  distance,
  dims,
  calibrated,
  onToggleDistance,
  onToggleDimensions,
  onClear,
}: MeasurePanelProps) {
  const hasResult = !!distance?.mm || (dimensionsOn && !!dims);

  return (
    <View style={kit.panel} pointerEvents="box-none">
      <View style={kit.bar}>
        <Section title="MEASURE">
          <View style={kit.row}>
            <Chip label="Distance" glyph="↔" active={distanceOn} onPress={onToggleDistance} />
            <Chip label="Dims" glyph="⛶" active={dimensionsOn} onPress={onToggleDimensions} />
            <Chip label="Clear" glyph="✕" onPress={onClear} />
          </View>
        </Section>

        <View style={kit.divider} />

        <Section title="RESULT">
          <View style={local.result}>
            {distanceOn && (
              <Text style={local.readout}>
                {distance?.mm != null ? formatMm(distance.mm) : '— —'}
              </Text>
            )}
            {dimensionsOn && dims && (
              <View style={local.dims}>
                <Text style={local.dimLine}>L {formatMm(dims.l)}</Text>
                <Text style={local.dimLine}>H {formatMm(dims.h)}</Text>
                <Text style={local.dimLine}>D {formatMm(dims.d)}</Text>
              </View>
            )}
            {!distanceOn && !dimensionsOn && (
              <Text style={local.hint}>Pick Distance or Dims.</Text>
            )}
            {distanceOn && (
              <Text style={local.hint}>Tap two points on the model.</Text>
            )}
            {!calibrated && (distanceOn || dimensionsOn) && (
              <Text style={local.warn}>~ uncalibrated — no part lengths to scale mm</Text>
            )}
          </View>
        </Section>
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  result: { alignItems: 'center', minWidth: 150, gap: 4 },
  readout: { color: '#67e8f9', fontSize: 26, fontWeight: '800', letterSpacing: 0.5 },
  dims: { alignItems: 'center', gap: 1 },
  dimLine: { color: '#67e8f9', fontSize: 17, fontWeight: '700' },
  hint: { color: '#94a3b8', fontSize: 11, textAlign: 'center', maxWidth: 170 },
  warn: { color: '#fbbf24', fontSize: 10, textAlign: 'center', maxWidth: 170, marginTop: 2 },
});
