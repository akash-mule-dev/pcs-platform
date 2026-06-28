// AR bottom toolbar (pure RN, no native deps). Tabs, each toggling a docked
// panel above it: Align (move/rotate/scale), Display (the merged appearance tab:
// surface colour-by + see-through + edge overlay), Measure (dimensions/rulers).
// There is no separate render-mode button — the edge overlay toggle lives inside
// the Display panel. (The old separate "Color" tab was merged into Display.)
//
// The open tab is clearly highlighted: bright fill + white text + a white
// indicator bar on top. Inactive tabs are muted. The indicator slot is always
// present (transparent when inactive) so the row height never shifts.
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, ScrollView } from 'react-native';

interface ToolBarProps {
  placed: boolean;
  /** Model is anchored to a surface ("Lock to surface") — also a "ready" state
   *  even when not free-placed, so the tools (Align in particular) are usable. */
  anchored?: boolean;
  modelLoaded: boolean;
  precisionMode: boolean;
  /** The merged "Display" / appearance tab open-state (legacy name: edges). */
  edgesPanelOpen: boolean;
  measurePanelOpen: boolean;
  onTogglePrecision: () => void;
  onToggleEdges: () => void;
  onToggleMeasure: () => void;
  /** Label + icon for the appearance tab. Defaults to "Edges"/"◰" (Viro, which
   *  only styles edges); the LiDAR experience passes "Display"/"◑" because that
   *  tab also carries colour-by + see-through. */
  appearanceLabel?: string;
  appearanceIcon?: string;
  /** Optional extra tab: point-pair registration ("Align by points"). Only rendered
   *  when onToggleRegister is provided (LiDAR only — Viro can't do it), so the
   *  shared Viro toolbar is unchanged. */
  registerPanelOpen?: boolean;
  onToggleRegister?: () => void;
  /** Optional extra tab: stability / anti-drift lock ("Lock"). Only rendered when
   *  onToggleLock is provided (LiDAR only), so the shared Viro toolbar is unchanged. */
  lockPanelOpen?: boolean;
  onToggleLock?: () => void;
  /** Layout: 'bottom' = the classic horizontal bar (default); 'right' = a vertical
   *  rail pinned to the right edge, slightly below centre, so the docked panel can
   *  sit low and the model keeps the whole middle of the screen. */
  side?: 'bottom' | 'right';
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
      <Text style={[styles.buttonIcon, active && styles.textActive]}>{icon}</Text>
      <Text style={[styles.buttonLabel, active && styles.textActive]}>{label}</Text>
      <View style={[styles.indicator, active && styles.indicatorActive]} />
    </TouchableOpacity>
  );
}

export default function ToolBar({
  placed,
  anchored = false,
  modelLoaded,
  precisionMode,
  edgesPanelOpen,
  measurePanelOpen,
  onTogglePrecision,
  onToggleEdges,
  onToggleMeasure,
  appearanceLabel = 'Edges',
  appearanceIcon = '◰',
  registerPanelOpen = false,
  onToggleRegister,
  lockPanelOpen = false,
  onToggleLock,
  side = 'bottom',
}: ToolBarProps) {
  if (!(modelLoaded && (placed || anchored))) return null;

  const tabs = (
    <>
      <Tab icon="#" label="Align" active={precisionMode} onPress={onTogglePrecision} />
      <Tab icon={appearanceIcon} label={appearanceLabel} active={edgesPanelOpen} onPress={onToggleEdges} />
      <Tab icon="M" label="Measure" active={measurePanelOpen} onPress={onToggleMeasure} />
      {onToggleRegister && (
        <Tab icon="⊹" label="Points" active={registerPanelOpen} onPress={onToggleRegister} />
      )}
      {onToggleLock && (
        <Tab icon="⚓" label="Lock" active={lockPanelOpen} onPress={onToggleLock} />
      )}
    </>
  );

  // Right-side vertical rail — frees the whole bottom + middle for the model.
  if (side === 'right') {
    return (
      <View style={styles.rightRail} pointerEvents="box-none">
        <View style={styles.rightRailInner}>{tabs}</View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbar}
        keyboardShouldPersistTaps="handled"
      >
        {tabs}
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
  // Vertical right-edge rail (side='right'): centred then nudged a little below.
  rightRail: {
    position: 'absolute',
    right: 6,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'flex-end',
    zIndex: 20,
  },
  rightRailInner: { gap: 10, marginTop: 40 },
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
  // Sits at the BOTTOM of the button (rendered after the label).
  indicator: {
    width: 26,
    height: 4,
    borderRadius: 2,
    marginTop: 6,
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
