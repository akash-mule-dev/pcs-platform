// 3D Viewer bottom tab bar — View / Color / Measure. Mirrors the AR viewer's
// ToolBar: each tab toggles a docked panel above it, the open tab is highlighted
// (cyan fill + white indicator bar), and the indicator slot is always present so
// the row height never shifts.
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

export type ViewerTab = 'view' | 'color' | 'measure';

interface ViewerToolBarProps {
  active: ViewerTab | null;
  onSelect: (tab: ViewerTab) => void;
}

const TABS: { tab: ViewerTab; icon: string; label: string }[] = [
  { tab: 'view', icon: '◈', label: 'View' },
  { tab: 'color', icon: '◑', label: 'Color' },
  { tab: 'measure', icon: '↔', label: 'Measure' },
];

export default function ViewerToolBar({ active, onSelect }: ViewerToolBarProps) {
  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.toolbar}>
        {TABS.map((t) => {
          const on = active === t.tab;
          return (
            <TouchableOpacity
              key={t.tab}
              style={[styles.button, on && styles.buttonActive]}
              onPress={() => onSelect(t.tab)}
              activeOpacity={0.8}
            >
              <View style={[styles.indicator, on && styles.indicatorActive]} />
              <Text style={[styles.icon, on && styles.textActive]}>{t.icon}</Text>
              <Text style={[styles.label, on && styles.textActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 28, paddingHorizontal: 16 },
  toolbar: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 12, paddingVertical: 10 },
  button: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 16,
    minWidth: 84,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
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
  indicator: { width: 26, height: 4, borderRadius: 2, marginBottom: 6, backgroundColor: 'transparent' },
  indicatorActive: { backgroundColor: '#ffffff' },
  icon: { fontSize: 18, fontWeight: 'bold', color: '#cbd5e1' },
  label: { fontSize: 11, color: '#cbd5e1', marginTop: 2, fontWeight: '700' },
  textActive: { color: '#ffffff' },
});
