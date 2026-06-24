import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, SectionList, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { timeTrackingService } from '../../services/time-tracking.service';
import { TimeEntry } from '../../types';
import { formatDuration, formatHm, formatDateGroup, formatClock } from '../../utils/duration';

interface Section { title: string; totalSeconds: number; data: TimeEntry[] }

const AMBER = '#f59e0b';

export function HistoryScreen() {
  const { user } = useAuth();
  const [sections, setSections] = useState<Section[]>([]);
  const [weekSeconds, setWeekSeconds] = useState(0);
  const [weekCount, setWeekCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const entries = await timeTrackingService.getHistory();
      const list = (Array.isArray(entries) ? entries : []).filter((e) => e.userId === user?.id && e.endTime);

      // Group by day, with a per-day total.
      const groups = new Map<string, TimeEntry[]>();
      for (const entry of list) {
        const key = new Date(entry.startTime).toDateString();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(entry);
      }
      const sectionData: Section[] = [];
      for (const [dateKey, items] of groups) {
        sectionData.push({
          title: formatDateGroup(dateKey),
          totalSeconds: items.reduce((s, e) => s + (e.durationSeconds || 0), 0),
          data: items.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
        });
      }
      sectionData.sort((a, b) => new Date(b.data[0].startTime).getTime() - new Date(a.data[0].startTime).getTime());
      setSections(sectionData);

      // Last-7-days rollup for the header.
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const week = list.filter((e) => new Date(e.startTime).getTime() >= weekAgo);
      setWeekSeconds(week.reduce((s, e) => s + (e.durationSeconds || 0), 0));
      setWeekCount(week.length);
    } catch {
      // silently keep last good state
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const onRefresh = async () => { setRefreshing(true); await loadHistory(); setRefreshing(false); };

  const getVariance = (entry: TimeEntry): { text: string; color: string } | null => {
    const target = entry.workOrderStage?.stage?.targetTimeSeconds;
    const actual = entry.durationSeconds;
    if (!target || !actual) return null;
    const pct = Math.round(((actual - target) / target) * 100);
    let color = AMBER;
    if (pct <= -10) color = Colors.success;
    else if (pct > 10) color = Colors.danger;
    return { text: `${pct > 0 ? '+' : ''}${pct}%`, color };
  };

  const renderItem = ({ item }: { item: TimeEntry }) => {
    const variance = getVariance(item);
    return (
      <View style={styles.entryCard}>
        <View style={styles.entryRow}>
          <View style={styles.entryInfo}>
            <Text style={styles.entryStage} numberOfLines={1}>{item.workOrderStage?.stage?.name || 'Stage'}</Text>
            <Text style={styles.entryOrder} numberOfLines={1}>
              {item.workOrderStage?.workOrder?.orderNumber || '—'} · {formatClock(item.startTime)}–{formatClock(item.endTime)}
            </Text>
          </View>
          <View style={styles.entryRight}>
            <Text style={styles.entryDuration}>{formatDuration(item.durationSeconds)}</Text>
            {variance && (
              <View style={[styles.varChip, { backgroundColor: variance.color }]}>
                <Text style={styles.varText}>{variance.text}</Text>
              </View>
            )}
          </View>
        </View>
        {(item.isRework || (item.idleSeconds ?? 0) > 0) && (
          <View style={styles.tagRow}>
            {item.isRework && <Text style={[styles.tag, styles.tagRework]}>rework</Text>}
            {(item.idleSeconds ?? 0) > 0 && <Text style={styles.tag}>idle {formatHm(item.idleSeconds)}</Text>}
          </View>
        )}
        {item.notes ? <Text style={styles.entryNotes}>{item.notes}</Text> : null}
      </View>
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /><Text style={styles.muted}>Loading history…</Text></View>;
  }

  return (
    <SectionList
      style={styles.container}
      contentContainerStyle={styles.list}
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ListHeaderComponent={
        sections.length > 0 ? (
          <View style={styles.weekCard}>
            <View>
              <Text style={styles.weekLabel}>LAST 7 DAYS</Text>
              <Text style={styles.weekValue}>{formatHm(weekSeconds)}</Text>
            </View>
            <Text style={styles.weekMeta}>{weekCount} {weekCount === 1 ? 'entry' : 'entries'}</Text>
          </View>
        ) : null
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <Text style={styles.sectionTotal}>{formatHm(section.totalSeconds)}</Text>
        </View>
      )}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      ListEmptyComponent={
        <View style={styles.center}>
          <Ionicons name="time-outline" size={34} color={Colors.medium} />
          <Text style={styles.muted}>No time entries yet</Text>
        </View>
      }
      stickySectionHeadersEnabled={false}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 10 },
  muted: { color: Colors.textSecondary, fontSize: 15 },

  weekCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.primary, borderRadius: 12, padding: 16, marginBottom: 16,
  },
  weekLabel: { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: 1 },
  weekValue: { fontSize: 26, fontWeight: '800', color: Colors.white, marginTop: 2 },
  weekMeta: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: Colors.text },
  sectionTotal: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },

  entryCard: { backgroundColor: Colors.white, borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: Colors.border },
  entryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  entryInfo: { flex: 1, paddingRight: 10 },
  entryStage: { fontSize: 15, fontWeight: '700', color: Colors.text },
  entryOrder: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  entryRight: { alignItems: 'flex-end', gap: 4 },
  entryDuration: { fontSize: 15, fontWeight: '800', color: Colors.text },
  varChip: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  varText: { fontSize: 11, fontWeight: '800', color: Colors.white },
  tagRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  tag: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary, backgroundColor: Colors.background, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  tagRework: { color: '#b45309', backgroundColor: '#fef3c7' },
  entryNotes: { fontSize: 13, color: Colors.medium, marginTop: 8, fontStyle: 'italic' },
});
