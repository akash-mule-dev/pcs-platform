// Ported verbatim from glb-viewer (pure RN, no native deps).
import React from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { RenderMode } from './types';

const RENDER_MODE_LABELS: Record<RenderMode, { icon: string; label: string }> = {
  solid: { icon: 'S', label: 'Solid' },
  ghost: { icon: 'G', label: 'Ghost' },
  wireframe: { icon: 'W', label: 'Wire' },
};

interface ToolBarProps {
  locked: boolean;
  placed: boolean;
  modelLoaded: boolean;
  precisionMode: boolean;
  measurePanelOpen: boolean;
  renderMode: RenderMode;
  hasWireframe: boolean;
  onToggleLock: () => void;
  onTogglePrecision: () => void;
  onToggleMeasure: () => void;
  onCycleRenderMode: () => void;
  onToggleEdges: () => void;
  onReset: () => void;
}

export default function ToolBar({
  locked,
  placed,
  modelLoaded,
  precisionMode,
  measurePanelOpen,
  renderMode,
  hasWireframe,
  onToggleLock,
  onTogglePrecision,
  onToggleMeasure,
  onCycleRenderMode,
  onToggleEdges,
  onReset,
}: ToolBarProps) {
  const modeInfo = RENDER_MODE_LABELS[renderMode];
  const edgesActive = renderMode === 'wireframe';

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbar}
        keyboardShouldPersistTaps="handled"
      >
        {/* Render Mode Toggle */}
        {modelLoaded && placed && (
          <TouchableOpacity
            style={[
              styles.button,
              renderMode === 'solid'
                ? styles.renderSolidButton
                : renderMode === 'ghost'
                  ? styles.renderGhostButton
                  : styles.renderWireButton,
            ]}
            onPress={onCycleRenderMode}
          >
            <Text style={styles.buttonIcon}>{modeInfo.icon}</Text>
            <Text style={styles.buttonLabel}>{modeInfo.label}</Text>
          </TouchableOpacity>
        )}

        {/* Edges-only Toggle (for dimension checking against the real object) */}
        {modelLoaded && placed && hasWireframe && (
          <TouchableOpacity
            style={[
              styles.button,
              edgesActive ? styles.edgesActiveButton : styles.edgesButton,
            ]}
            onPress={onToggleEdges}
          >
            <Text style={styles.buttonIcon}>□</Text>
            <Text style={styles.buttonLabel}>
              {edgesActive ? 'Edges On' : 'Edges'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Precision Button */}
        {modelLoaded && placed && (
          <TouchableOpacity
            style={[
              styles.button,
              precisionMode ? styles.precisionActiveButton : styles.precisionButton,
            ]}
            onPress={onTogglePrecision}
          >
            <Text style={styles.buttonIcon}>#</Text>
            <Text style={styles.buttonLabel}>Align</Text>
          </TouchableOpacity>
        )}

        {/* Measure Button */}
        {modelLoaded && placed && (
          <TouchableOpacity
            style={[
              styles.button,
              measurePanelOpen ? styles.measureActiveButton : styles.measureButton,
            ]}
            onPress={onToggleMeasure}
          >
            <Text style={styles.buttonIcon}>M</Text>
            <Text style={styles.buttonLabel}>Measure</Text>
          </TouchableOpacity>
        )}

        {/* Lock/Unlock Button */}
        {modelLoaded && placed && (
          <TouchableOpacity
            style={[
              styles.button,
              locked ? styles.lockedButton : styles.unlockedButton,
            ]}
            onPress={onToggleLock}
          >
            <Text style={styles.buttonIcon}>{locked ? 'L' : 'U'}</Text>
            <Text style={styles.buttonLabel}>
              {locked ? 'Locked' : 'Unlocked'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Reset Button */}
        {modelLoaded && placed && (
          <TouchableOpacity
            style={[styles.button, styles.resetButton]}
            onPress={onReset}
          >
            <Text style={styles.buttonIcon}>R</Text>
            <Text style={styles.buttonLabel}>Reset</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Status hints */}
      {modelLoaded && locked && (
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            Position locked - move camera to view from different angles
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    paddingHorizontal: 16,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    flexGrow: 1,
  },
  button: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    minWidth: 68,
  },
  renderSolidButton: {
    backgroundColor: 'rgba(100, 116, 139, 0.9)',
  },
  renderGhostButton: {
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
  },
  renderWireButton: {
    backgroundColor: 'rgba(0, 200, 0, 0.9)',
  },
  edgesButton: {
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.9)',
  },
  edgesActiveButton: {
    backgroundColor: 'rgba(14, 165, 233, 0.95)',
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  precisionButton: {
    backgroundColor: 'rgba(139, 92, 246, 0.9)',
  },
  precisionActiveButton: {
    backgroundColor: 'rgba(236, 72, 153, 0.9)',
  },
  measureButton: {
    backgroundColor: 'rgba(6, 182, 212, 0.9)',
  },
  measureActiveButton: {
    backgroundColor: 'rgba(14, 165, 233, 0.95)',
  },
  lockedButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
  },
  unlockedButton: {
    backgroundColor: 'rgba(34, 197, 94, 0.9)',
  },
  resetButton: {
    backgroundColor: 'rgba(107, 114, 128, 0.9)',
  },
  buttonIcon: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  buttonLabel: {
    fontSize: 10,
    color: '#ffffff',
    marginTop: 2,
    fontWeight: '600',
  },
  statusContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.8)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignSelf: 'center',
    marginBottom: 8,
  },
  statusText: {
    color: '#ffffff',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
});
