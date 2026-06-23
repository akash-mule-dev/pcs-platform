// "View" tab — camera presets + render mode for the 3D Viewer.
import React from 'react';
import { View } from 'react-native';
import { Section, Chip, styles } from './panelKit';
import { ViewerCameraPreset, ViewerRenderMode } from '../PartWebViewer';

interface ViewPanelProps {
  renderMode: ViewerRenderMode;
  onPreset: (preset: ViewerCameraPreset) => void;
  onRenderMode: (mode: ViewerRenderMode) => void;
}

const PRESETS: { preset: ViewerCameraPreset; label: string; glyph: string }[] = [
  { preset: 'reset', label: 'Reset', glyph: '⟲' },
  { preset: 'iso', label: 'Iso', glyph: '◈' },
  { preset: 'front', label: 'Front', glyph: '▭' },
  { preset: 'top', label: 'Top', glyph: '▢' },
  { preset: 'side', label: 'Side', glyph: '▯' },
];

const RENDER: { mode: ViewerRenderMode; label: string; glyph: string }[] = [
  { mode: 'solid', label: 'Solid', glyph: '■' },
  { mode: 'wireframe', label: 'Wire', glyph: '◰' },
];

export default function ViewPanel({ renderMode, onPreset, onRenderMode }: ViewPanelProps) {
  return (
    <View style={styles.panel} pointerEvents="box-none">
      <View style={styles.bar}>
        <Section title="CAMERA">
          <View style={styles.row}>
            {PRESETS.map((p) => (
              <Chip key={p.preset} label={p.label} glyph={p.glyph} onPress={() => onPreset(p.preset)} />
            ))}
          </View>
        </Section>

        <View style={styles.divider} />

        <Section title="RENDER">
          <View style={styles.row}>
            {RENDER.map((r) => (
              <Chip
                key={r.mode}
                label={r.label}
                glyph={r.glyph}
                active={renderMode === r.mode}
                onPress={() => onRenderMode(r.mode)}
              />
            ))}
          </View>
        </Section>
      </View>
    </View>
  );
}
