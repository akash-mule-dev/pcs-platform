// MarkerOverlay — the in-view "which printed markers are recognised right now" HUD for
// the LiDAR inspector. The native view draws a 3D highlight ON each physical marker
// (PcsLidarArView); this 2D card is its on-screen index: a colour-keyed list of the
// detected markers with id + distance + state, so the inspector can confirm at a glance
// what the engine sees and whether enough are bound to hold the model. Pure RN.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  MarkerView,
  markerVisualState,
  markerStateColor,
  markerStateLabel,
  formatDistance,
  summarizeMarkers,
  sortMarkersForDisplay,
} from './marker-format';

interface Props {
  markers: MarkerView[];
  markerLockOn: boolean;
  holding: boolean;
  /** Distance from the top of the screen (keeps clear of the name block). */
  top?: number;
  /** Max rows shown (nearest/active first). */
  maxRows?: number;
}

export default function MarkerOverlay({ markers, markerLockOn, holding, top = 150, maxRows = 6 }: Props) {
  if (!markers.length) return null;
  const s = summarizeMarkers(markers);
  const rows = sortMarkersForDisplay(markers).slice(0, maxRows);
  const hidden = markers.length - rows.length;

  return (
    <View style={[styles.wrap, { top }]} pointerEvents="none">
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Markers</Text>
          <Text style={styles.count}>
            {s.tracked}/{s.total} seen{s.bound ? ` · ${s.contributing}/${s.bound} holding` : ''}
          </Text>
        </View>
        {rows.map((m) => {
          const st = markerVisualState(m);
          return (
            <View key={m.name} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: markerStateColor(st) }]} />
              <Text style={styles.name} numberOfLines={1}>{m.name}</Text>
              <Text style={styles.meta}>{formatDistance(m.distanceM)}</Text>
              <Text style={[styles.state, { color: markerStateColor(st) }]}>{markerStateLabel(st)}</Text>
            </View>
          );
        })}
        {hidden > 0 && <Text style={styles.more}>+{hidden} more</Text>}
        {markerLockOn && holding && (
          <Text style={styles.holdWarn}>Holding last pose — re-aim at a marker</Text>
        )}
        {!markerLockOn && s.bound === 0 && (
          <Text style={styles.hint}>Open Lock → Bind to pin the model to these</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, alignItems: 'flex-start' },
  card: {
    minWidth: 196,
    maxWidth: 260,
    backgroundColor: 'rgba(13, 17, 23, 0.82)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.22)',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { color: '#f1f5f9', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  count: { color: '#94a3b8', fontSize: 10, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  name: { color: '#e2e8f0', fontSize: 11, fontWeight: '700', flex: 1 },
  meta: { color: '#cbd5e1', fontSize: 10, marginHorizontal: 6 },
  state: { fontSize: 10, fontWeight: '700', width: 54, textAlign: 'right' },
  more: { color: '#64748b', fontSize: 10, marginTop: 2 },
  holdWarn: { color: '#f59e0b', fontSize: 10, fontWeight: '700', marginTop: 5 },
  hint: { color: '#94a3b8', fontSize: 10, marginTop: 5 },
});
