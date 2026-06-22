// AR bottom toolbar (pure RN, no native deps). Three tabs, each toggling a
// docked panel: Align (move/rotate/scale), Edges (view/colour/weight), Measure.
// There is no separate render-mode button — Solid/Ghost/Edges live inside the
// Edges panel's VIEW section, so the toolbar is just the three panel tabs.
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, ScrollView } from 'react-native';

interface ToolBarProps {
  placed: boolean;
  modelLoaded: boolean;
  precisionMode: boolean;
  edgesPanelOpen: boolean;
  measurePanelOpen: boolean;
  onTogglePrecision: () => void;
  onToggleEdges: () => void;
  onToggleMeasure: () => void;
}

export default function ToolBar({
  placed,
  modelLoaded,
  precisionMode,
  edgesPanelOpen,
  measurePanelOpen,
  onTogglePrecision,
  onToggleEdges,
  onToggleMeasure,
}: ToolBarProps) {
  const ready = modelLoaded && placed;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbar}
        keyboardShouldPersistTaps="handled"
      >
        {/* Align */}
        {ready && (
          <TouchableOpacity
            style={[styles.button, precisionMode ? styles.alignActiveButton : styles.alignButton]}
            onPress={onTogglePrecision}
          >
            <Text style={styles.buttonIcon}>#</Text>
            <Text style={styles.buttonLabel}>Align</Text>
          </TouchableOpacity>
        )}

        {/* Edges */}
        {ready && (
          <TouchableOpacity
            style={[styles.button, edgesPanelOpen ? styles.edgesActiveButton : styles.edgesButton]}
            onPress={onToggleEdges}
          >
            <Text style={styles.buttonIcon}>◰</Text>
            <Text style={styles.buttonLabel}>Edges</Text>
          </TouchableOpacity>
        )}

        {/* Measure */}
        {ready && (
          <TouchableOpacity
            style={[styles.button, measurePanelOpen ? styles.measureActiveButton : styles.measureButton]}
            onPress={onToggleMeasure}
          >
            <Text style={styles.buttonIcon}>M</Text>
            <Text style={styles.buttonLabel}>Measure</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
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
  alignButton: { backgroundColor: 'rgba(139, 92, 246, 0.9)' },
  alignActiveButton: { backgroundColor: 'rgba(236, 72, 153, 0.9)' },
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
  measureButton: { backgroundColor: 'rgba(6, 182, 212, 0.9)' },
  measureActiveButton: { backgroundColor: 'rgba(14, 165, 233, 0.95)' },
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
});
