// In-AR quality panel: pass/fail/warning summary, the list of logged
// inspections for this model, a button to log a new one, and tap-to-sign-off.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Colors } from '../../../theme/colors';
import { ARQualityEntry, summarize } from './useQualityData';

interface Props {
  entries: ARQualityEntry[];
  loading: boolean;
  onClose: () => void;
  onLogNew: () => void;
  onSignoff: (entry: ARQualityEntry) => void;
}

const STATUS_COLOR: Record<string, string> = {
  pass: Colors.success,
  fail: Colors.danger,
  warning: Colors.warning,
};

export default function QualityPanel({ entries, loading, onClose, onLogNew, onSignoff }: Props) {
  const s = summarize(entries);

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Quality Inspection</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.close}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summaryRow}>
        <Summary label="Pass" count={s.pass} color={Colors.success} />
        <Summary label="Fail" count={s.fail} color={Colors.danger} />
        <Summary label="Warn" count={s.warning} color={Colors.warning} />
      </View>

      <TouchableOpacity style={styles.logBtn} onPress={onLogNew}>
        <Text style={styles.logBtnText}>＋ Log inspection</Text>
      </TouchableOpacity>

      {loading && <ActivityIndicator color={Colors.primary} style={{ marginTop: 12 }} />}

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {entries.map((e) => (
          <TouchableOpacity key={e.id} style={styles.entry} onPress={() => onSignoff(e)} activeOpacity={0.7}>
            <View style={[styles.dot, { backgroundColor: STATUS_COLOR[e.status] || Colors.medium }]} />
            <View style={styles.entryBody}>
              <Text style={styles.entryMesh} numberOfLines={1}>{e.meshName}</Text>
              <Text style={styles.entryMeta} numberOfLines={1}>
                {e.status.toUpperCase()}
                {e.defectType ? ` · ${e.defectType}` : ''}
                {e.severity ? ` · ${e.severity}` : ''}
              </Text>
            </View>
            {e.signoffStatus && e.signoffStatus !== 'pending' && (
              <Text
                style={[
                  styles.signoffBadge,
                  { color: e.signoffStatus === 'approved' ? Colors.success : Colors.danger },
                ]}
              >
                {e.signoffStatus === 'approved' ? '✓' : '✗'}
              </Text>
            )}
          </TouchableOpacity>
        ))}
        {!loading && entries.length === 0 && (
          <Text style={styles.empty}>No inspections yet. Tap “Log inspection”.</Text>
        )}
      </ScrollView>
    </View>
  );
}

function Summary({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={[styles.summaryCount, { color }]}>{count}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 100,
    right: 12,
    bottom: 120,
    width: 270,
    backgroundColor: 'rgba(13,17,23,0.92)',
    borderRadius: 16,
    padding: 14,
    zIndex: 30,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { color: '#fff', fontSize: 15, fontWeight: '700' },
  close: { color: '#cbd5e1', fontSize: 18 },
  summaryRow: { flexDirection: 'row', gap: 8 },
  summaryItem: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  summaryCount: { fontSize: 18, fontWeight: '700' },
  summaryLabel: { fontSize: 11, color: '#8892b0', marginTop: 2 },
  logBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  logBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  list: { marginTop: 12 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  entryBody: { flex: 1 },
  entryMesh: { color: '#fff', fontSize: 13, fontWeight: '600' },
  entryMeta: { color: '#8892b0', fontSize: 11, marginTop: 2 },
  signoffBadge: { fontSize: 16, fontWeight: '700', marginLeft: 6 },
  empty: { color: '#8892b0', fontSize: 12, textAlign: 'center', marginTop: 16, lineHeight: 18 },
});
