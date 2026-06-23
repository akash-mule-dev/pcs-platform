import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { timeTrackingService } from '../../services/time-tracking.service';
import { workOrderService } from '../../services/work-order.service';
import { offlineService } from '../../services/offline.service';
import { TimeEntry, WorkOrder, WorkOrderStage } from '../../types';
import { formatTimer, formatDuration, formatHm, formatClock } from '../../utils/duration';
import { notifySuccess, notifyError } from '../../utils/feedback';
import { TimeTrackingStackParamList } from '../../navigation/types';
import { useSocketEvents } from '../../hooks/useSocketEvent';

type Nav = NativeStackNavigationProp<TimeTrackingStackParamList, 'TimerMain'>;

interface OrderGroup { order: WorkOrder; stages: WorkOrderStage[] }

const AMBER = '#f59e0b';

// Elapsed-vs-target colour: green under, amber near, red over.
function targetColor(elapsed: number, target: number): string {
  const pct = elapsed / target;
  if (pct <= 0.9) return Colors.success;
  if (pct <= 1.1) return AMBER;
  return Colors.danger;
}

export function TimerScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [notes, setNotes] = useState('');
  const [groups, setGroups] = useState<OrderGroup[]>([]);
  const [todaySeconds, setTodaySeconds] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadState = useCallback(async () => {
    try {
      const [activeEntries, history] = await Promise.all([
        timeTrackingService.getActive(),
        timeTrackingService.getHistory().catch(() => [] as TimeEntry[]),
      ]);
      const myActive = activeEntries.find((e) => e.userId === user?.id && !e.endTime) || null;
      setActiveEntry(myActive);

      // Today's logged time (completed entries) for the summary strip.
      const today = new Date().toDateString();
      const todays = (history || []).filter(
        (e) => e.userId === user?.id && e.endTime && new Date(e.startTime).toDateString() === today,
      );
      setTodaySeconds(todays.reduce((s, e) => s + (e.durationSeconds || 0), 0));
      setTodayCount(todays.length);

      if (!myActive) {
        // Stages available to clock into, GROUPED by work order. Details are
        // fetched in PARALLEL (the list endpoint omits stages) — no serial N+1.
        const orders = await workOrderService.getAll({ status: 'in_progress' });
        const list = Array.isArray(orders) ? orders : [];
        const details = await Promise.all(
          list.map((o) => workOrderService.getById(o.id).catch(() => null)),
        );
        const grouped: OrderGroup[] = [];
        for (const d of details) {
          if (!d) continue;
          const stages = (d.stages || [])
            .filter((s) => s.status === 'pending' || s.status === 'in_progress')
            .sort((a, b) => (a.stage?.sequence ?? 0) - (b.stage?.sequence ?? 0));
          if (stages.length) grouped.push({ order: d, stages });
        }
        grouped.sort((a, b) => a.order.orderNumber.localeCompare(b.order.orderNumber));
        setGroups(grouped);
      } else {
        setGroups([]);
      }
    } catch {
      // keep last good state
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { loadState(); }, [loadState]);
  useSocketEvents(['time-entry-update', 'stage-update', 'dashboard-refresh'], loadState);

  // Timer tick
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (!activeEntry) { setElapsed(0); return; }
    const start = new Date(activeEntry.startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    tickRef.current = setInterval(tick, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [activeEntry]);

  const handleClockIn = async (stage: WorkOrderStage, orderNumber: string) => {
    if (busyStage) return;
    setBusyStage(stage.id);
    try {
      if (offlineService.isOnline) {
        await timeTrackingService.clockIn(stage.id);
        notifySuccess('Clocked in');
        await loadState();
      } else {
        await offlineService.queueAction('clock-in', { workOrderStageId: stage.id });
        notifySuccess('Clock-in queued — will sync');
        // Reflect the running timer locally (offline loadState can't reach the
        // server) so the worker sees it immediately and can't double clock-in.
        setActiveEntry({
          id: `offline-${stage.id}-${Date.now()}`,
          userId: user?.id ?? '',
          workOrderStageId: stage.id,
          workOrderStage: {
            id: stage.id,
            status: 'in_progress',
            workOrder: { id: stage.workOrderId, orderNumber },
            stage: stage.stage
              ? { id: stage.stage.id, name: stage.stage.name, targetTimeSeconds: stage.stage.targetTimeSeconds, sequence: stage.stage.sequence }
              : undefined,
          },
          stationId: null,
          startTime: new Date().toISOString(),
          endTime: null,
          durationSeconds: null,
          breakSeconds: 0,
          idleSeconds: 0,
          inputMethod: 'mobile',
          isRework: false,
          notes: null,
          createdAt: new Date().toISOString(),
        });
        setGroups([]);
      }
    } catch (err: any) {
      notifyError();
      Alert.alert('Error', err.message || 'Failed to clock in');
    } finally {
      setBusyStage(null);
    }
  };

  const handleClockOut = async () => {
    if (!activeEntry) return;
    setClockingOut(true);
    try {
      if (offlineService.isOnline) {
        await timeTrackingService.clockOut(activeEntry.id, notes || undefined);
        notifySuccess('Clocked out');
        setNotes('');
        setActiveEntry(null);
        await loadState();
      } else {
        await offlineService.queueAction('clock-out', { timeEntryId: activeEntry.id, notes: notes || undefined });
        notifySuccess('Clock-out queued — will sync');
        // Clear the hero locally; the clock-in list refreshes on the next online load.
        setNotes('');
        setActiveEntry(null);
      }
    } catch (err: any) {
      notifyError();
      Alert.alert('Error', err.message || 'Failed to clock out');
    } finally {
      setClockingOut(false);
    }
  };

  const onRefresh = async () => { setRefreshing(true); await loadState(); setRefreshing(false); };

  // Search filter (order number / process / stage name).
  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => {
        const orderMatch = g.order.orderNumber.toLowerCase().includes(q) || (g.order.process?.name ?? '').toLowerCase().includes(q);
        const stages = orderMatch ? g.stages : g.stages.filter((s) => (s.stage?.name ?? '').toLowerCase().includes(q));
        return { ...g, stages };
      })
      .filter((g) => g.stages.length > 0);
  }, [groups, query]);

  const stageCount = useMemo(() => groups.reduce((n, g) => n + g.stages.length, 0), [groups]);
  const todayLive = todaySeconds + (activeEntry ? elapsed : 0);

  const target = activeEntry?.workOrderStage?.stage?.targetTimeSeconds || 0;
  const tColor = target ? targetColor(elapsed, target) : Colors.primary;
  const barPct = target ? Math.min(100, (elapsed / target) * 100) : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      {/* ── Today summary strip ── */}
      <View style={styles.todayStrip}>
        <View style={styles.todayLeft}>
          <Text style={styles.todayLabel}>TODAY</Text>
          <Text style={styles.todayValue}>{formatHm(todayLive)}</Text>
          <Text style={styles.todayMeta}>
            {todayCount} {todayCount === 1 ? 'entry' : 'entries'}{activeEntry ? ' · running' : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.historyBtn} onPress={() => navigation.navigate('History')}>
          <Ionicons name="time-outline" size={16} color={Colors.primary} />
          <Text style={styles.historyBtnText}>History</Text>
        </TouchableOpacity>
      </View>

      {activeEntry ? (
        /* ── Active timer (hero) ── */
        <View style={styles.heroCard}>
          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>RUNNING</Text>
            <Text style={styles.startedAt}>Started {formatClock(activeEntry.startTime)}</Text>
          </View>

          <Text style={styles.stageName} numberOfLines={2}>
            {activeEntry.workOrderStage?.stage?.name || 'Stage'}
          </Text>
          <Text style={styles.orderNumber}>
            {activeEntry.workOrderStage?.workOrder?.orderNumber || ''}
          </Text>

          <Text style={[styles.timerText, { color: target ? tColor : Colors.text }]}>{formatTimer(elapsed)}</Text>

          {target > 0 ? (
            <View style={styles.targetWrap}>
              <View style={styles.targetTrack}>
                <View style={[styles.targetFill, { width: `${barPct}%`, backgroundColor: tColor }]} />
              </View>
              <Text style={[styles.targetLabel, { color: tColor }]}>
                {elapsed <= target
                  ? `${formatHm(target - elapsed)} left of ${formatHm(target)} target`
                  : `${formatHm(elapsed - target)} over ${formatHm(target)} target`}
              </Text>
            </View>
          ) : (
            <Text style={styles.noTarget}>No target time set</Text>
          )}

          <TextInput
            style={styles.notesInput}
            placeholder="Add notes (optional)"
            placeholderTextColor={Colors.medium}
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          <TouchableOpacity
            style={[styles.clockOutButton, clockingOut && styles.disabled]}
            onPress={handleClockOut}
            disabled={clockingOut}
          >
            {clockingOut ? <ActivityIndicator color={Colors.white} /> : <Ionicons name="stop" size={20} color={Colors.white} />}
            <Text style={styles.clockOutText}>{clockingOut ? 'Stopping…' : 'Clock Out'}</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /><Text style={styles.muted}>Loading stages…</Text></View>
      ) : (
        /* ── Clock in: stages grouped by work order ── */
        <View>
          <View style={styles.clockInHead}>
            <Text style={styles.sectionTitle}>Clock in</Text>
            {stageCount > 0 && <Text style={styles.sectionMeta}>{stageCount} stages · {groups.length} orders</Text>}
          </View>

          {groups.length > 3 && (
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={Colors.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search order or stage…"
                placeholderTextColor={Colors.textSecondary}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              {!!query && <TouchableOpacity onPress={() => setQuery('')}><Ionicons name="close-circle" size={16} color={Colors.textSecondary} /></TouchableOpacity>}
            </View>
          )}

          {visibleGroups.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="timer-outline" size={34} color={Colors.medium} />
              <Text style={styles.muted}>
                {query ? 'No stages match your search.' : 'No stages available to clock into right now.'}
              </Text>
            </View>
          ) : (
            visibleGroups.map((g) => (
              <View key={g.order.id} style={styles.orderGroup}>
                <View style={styles.orderHeader}>
                  <Ionicons name="cube-outline" size={16} color={Colors.primary} />
                  <Text style={styles.orderHeaderNum} numberOfLines={1}>{g.order.orderNumber}</Text>
                  {!!g.order.process?.name && <Text style={styles.orderHeaderProcess} numberOfLines={1}>{g.order.process.name}</Text>}
                  <Text style={styles.orderHeaderCount}>{g.stages.length}</Text>
                </View>
                {g.stages.map((s) => {
                  const busy = busyStage === s.id;
                  const inProg = s.status === 'in_progress';
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={styles.stageRow}
                      onPress={() => handleClockIn(s, g.order.orderNumber)}
                      disabled={!!busyStage}
                      activeOpacity={0.7}
                    >
                      <View style={styles.stageInfo}>
                        <View style={styles.stageNameRow}>
                          <Text style={styles.stageRowName} numberOfLines={1}>{s.stage?.name || 'Stage'}</Text>
                          {inProg && <View style={styles.inProgBadge}><Text style={styles.inProgText}>in progress</Text></View>}
                        </View>
                        {!!s.stage?.targetTimeSeconds && (
                          <Text style={styles.stageTarget}>Target {formatDuration(s.stage.targetTimeSeconds)}</Text>
                        )}
                      </View>
                      {busy ? (
                        <ActivityIndicator color={Colors.success} />
                      ) : (
                        <Ionicons name="play-circle" size={32} color={Colors.success} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
  muted: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', maxWidth: 280 },

  // Today strip
  todayStrip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderRadius: 12, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.border,
  },
  todayLeft: { flex: 1 },
  todayLabel: { fontSize: 11, fontWeight: '800', color: Colors.textSecondary, letterSpacing: 1 },
  todayValue: { fontSize: 26, fontWeight: '800', color: Colors.text, marginTop: 2, fontVariant: ['tabular-nums'] },
  todayMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  historyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: Colors.primary },
  historyBtnText: { color: Colors.primary, fontWeight: '700', fontSize: 13 },

  // Hero active timer
  heroCard: { backgroundColor: Colors.white, borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'stretch' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  liveText: { fontSize: 11, fontWeight: '800', color: Colors.success, letterSpacing: 1 },
  startedAt: { marginLeft: 'auto', fontSize: 12, color: Colors.textSecondary },
  stageName: { fontSize: 22, fontWeight: '800', color: Colors.text, marginTop: 14, textAlign: 'center' },
  orderNumber: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  timerText: { fontSize: 56, fontWeight: '800', marginTop: 14, fontVariant: ['tabular-nums'], letterSpacing: 1 },
  targetWrap: { alignSelf: 'stretch', marginTop: 14 },
  targetTrack: { height: 8, borderRadius: 4, backgroundColor: '#e5e9f0', overflow: 'hidden' },
  targetFill: { height: '100%', borderRadius: 4 },
  targetLabel: { fontSize: 13, fontWeight: '700', marginTop: 6, textAlign: 'center' },
  noTarget: { fontSize: 13, color: Colors.textSecondary, marginTop: 14 },
  notesInput: {
    alignSelf: 'stretch', borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12,
    fontSize: 15, color: Colors.text, backgroundColor: Colors.background, textAlignVertical: 'top',
    minHeight: 70, marginTop: 18,
  },
  clockOutButton: {
    alignSelf: 'stretch', height: 54, backgroundColor: Colors.danger, borderRadius: 12,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 14,
  },
  clockOutText: { color: Colors.white, fontSize: 17, fontWeight: '800' },
  disabled: { opacity: 0.6 },

  // Clock-in list
  clockInHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: Colors.text },
  sectionMeta: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 36, gap: 10 },

  orderGroup: { backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, marginBottom: 12, overflow: 'hidden' },
  orderHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#f1f5f9', borderBottomWidth: 1, borderBottomColor: Colors.border },
  orderHeaderNum: { fontSize: 14, fontWeight: '800', color: Colors.text },
  orderHeaderProcess: { fontSize: 12, color: Colors.textSecondary, flex: 1 },
  orderHeaderCount: { fontSize: 12, fontWeight: '800', color: Colors.textSecondary, backgroundColor: Colors.white, borderRadius: 10, minWidth: 22, paddingHorizontal: 6, paddingVertical: 1, textAlign: 'center', overflow: 'hidden' },
  stageRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  stageInfo: { flex: 1 },
  stageNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stageRowName: { fontSize: 16, fontWeight: '700', color: Colors.text, flexShrink: 1 },
  inProgBadge: { backgroundColor: '#fef3c7', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  inProgText: { fontSize: 10, fontWeight: '800', color: '#b45309' },
  stageTarget: { fontSize: 12, color: Colors.textSecondary, marginTop: 3 },
});
