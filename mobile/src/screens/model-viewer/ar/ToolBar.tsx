// AR bottom toolbar (pure RN, no native deps). Three tabs, each toggling a
// docked panel above it: Align (move/rotate/scale), Edges (view/colour/weight),
// Measure (dimensions/rulers). There is no separate render-mode button —
// Solid/Edges live inside the Edges panel's VIEW section.
//
// The open tab is clearly highlighted: bright fill + white text + a white
// indicator bar on top. Inactive tabs are muted. The indicator slot is always
// present (transparent when inactive) so the row height never shifts.
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

function Tab({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.button, active && styles.buttonActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.indicator, active && styles.indicatorActive]} />
      <Text style={[styles.buttonIcon, active && styles.textActive]}>{icon}</Text>
      <Text style={[styles.buttonLabel, active && styles.textActive]}>{label}</Text>
    </TouchableOpacity>
  );
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
  if (!(modelLoaded && placed)) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbar}
        keyboardShouldPersistTaps="handled"
      >
        <Tab icon="#" label="Align" active={precisionMode} onPress={onTogglePrecision} />
        <Tab icon="◰" label="Edges" active={edgesPanelOpen} onPress={onToggleEdges} />
        <Tab icon="M" label="Measure" active={measurePanelOpen} onPress={onToggleMeasure} />
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
    alignItems: 'flex-end',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    flexGrow: 1,
  },
  button: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 16,
    minWidth: 80,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
  },
  buttonActive: {
    backgroundColor: 'rgba(14, 165, 233, 0.97)',
    borderColor: '#ffffff',
    shadowColor: '#0ea5e9',
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  // Always-present slot so active/inactive heights match; only painted when active.
  indicator: {
    width: 26,
    height: 4,
    borderRadius: 2,
    marginBottom: 6,
    backgroundColor: 'transparent',
  },
  indicatorActive: { backgroundColor: '#ffffff' },
  buttonIcon: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#cbd5e1',
  },
  buttonLabel: {
    fontSize: 11,
    color: '#cbd5e1',
    marginTop: 2,
    fontWeight: '700',
  },
  textActive: { color: '#ffffff' },
});
