import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, StatusColors } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { timeTrackingService } from '../../services/time-tracking.service';
import {
  dashboardService,
  DashboardSummary,
  LiveStatusEntry,
  MyDayStats,
} from '../../services/dashboard.service';
import { TimeEntry } from '../../types';
import { formatDuration, formatTimer } from '../../utils/duration';
import { useSocketEvents } from '../../hooks/useSocketEvent';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 18) return 'Good Afternoon';
  return 'Good Evening';
}

/** Stable display order for the status breakdown (web keeps API order, which
 *  is GROUP BY dependent — on a phone a fixed order reads better). */
const STATUS_ORDER = ['draft', 'pending', 'in_progress', 'completed', 'cancelled'];

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const LIVE_ROWS_SHOWN = 5;

export function DashboardScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);

  // Server-driven state — same endpoints as the web portal dashboard.
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [liveEntries, setLiveEntries] = useState<LiveStatusEntry[]>([]);
  const [myDay, setMyDay] = useState<MyDayStats | null>(null);
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [now, setNow] = useState(Date.now());

  const loadData = useCallback(async () => {
    // Each section degrades independently (mirrors the web dashboard, where a
    // failing widget shows "—" instead of blanking the whole page).
    const [summaryRes, liveRes, myDayRes, activeRes] = await Promise.allSettled([
      dashboardService.getSummary(),
      dashboardService.getLiveStatus(),
      dashboardService.getMyDay(),
      timeTrackingService.getActive(),
    ]);

    if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value);
    if (liveRes.status === 'fulfilled') setLiveEntries(liveRes.value ?? []);
    if (myDayRes.status === 'fulfilled') setMyDay(myDayRes.value);
    if (activeRes.status === 'fulfilled') {
      const mine = (activeRes.value ?? []).find(
        (e) => e.userId === user?.id && !e.endTime,
      );
      setActiveEntry(mine || null);
    }

    if (__DEV__) {
      [summaryRes, liveRes, myDayRes, activeRes]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .forEach((r) => console.warn('Dashboard load failed:', r.reason));
    }
  }, [user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time: refresh the moment anything changes on any client (web or
  // mobile) — the same event set the web dashboard subscribes to.
  useSocketEvents(
    ['dashboard-refresh', 'time-entry-update', 'stage-update', 'work-order-update'],
    loadData,
  );

  // 30s polling safety-net (web parity) in case socket events are missed.
  useEffect(() => {
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // 1s tick drives the active-timer card and the live elapsed columns.
  const needsTick = !!activeEntry || liveEntries.length > 0;
  useEffect(() => {
    if (!needsTick) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [needsTick]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const elapsedSeconds = (startTime: string): number =>
    startTime ? Math.max(0, Math.floor((now - new Date(startTime).getTime()) / 1000)) : 0;

  // ── Derived KPI values (same math as the web component) ──
  const statusRows = useMemo(() => {
    const rows = [...(summary?.workOrdersByStatus ?? [])];
    rows.sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a.status);
      const bi = STATUS_ORDER.indexOf(b.status);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.status.localeCompare(b.status);
    });
    return rows.map((r) => ({ ...r, value: parseInt(r.count, 10) || 0 }));
  }, [summary]);

  const totalWorkOrders = useMemo(
    () => statusRows.reduce((sum, r) => sum + r.value, 0),
    [statusRows],
  );
  const maxStatusCount = useMemo(
    () => Math.max(1, ...statusRows.map((r) => r.value)),
    [statusRows],
  );
  const efficiencyLabel = summary?.avgEfficiency
    ? `${Math.round(Math.min(summary.avgEfficiency, 100))}%`
    : '—';

  const liveShown = liveEntries.slice(0, LIVE_ROWS_SHOWN);
  const liveOverflow = liveEntries.length - liveShown.length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      <Text style={styles.greeting}>
        {getGreeting()}, {user?.firstName || 'Operator'}
      </Text>

      {/* Active Timer Card */}
      {activeEntry && (
        <TouchableOpacity
          style={styles.activeCard}
          onPress={() => navigation.navigate('Timer')}
        >
          <View style={styles.activeCardHeader}>
            <Ionicons name="timer" size={20} color={Colors.white} />
            <Text style={styles.activeCardTitle}>Active Timer</Text>
          </View>
          <Text style={styles.activeTimer}>
            {formatTimer(elapsedSeconds(activeEntry.startTime))}
          </Text>
          <Text style={styles.activeLabel}>
            {activeEntry.workOrderStage?.stage?.name || 'Stage'} -{' '}
            {activeEntry.workOrderStage?.workOrder?.orderNumber || ''}
          </Text>
        </TouchableOpacity>
      )}

      {/* Org-wide KPIs — same values as the web portal dashboard */}
      <Text style={styles.sectionTitle}>Production Overview</Text>
      <View style={styles.kpiGrid}>
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIcon, { backgroundColor: '#e3f2fd' }]}>
            <Ionicons name="clipboard" size={20} color={Colors.primary} />
          </View>
          <Text style={styles.kpiValue}>{summary ? totalWorkOrders : '—'}</Text>
          <Text style={styles.kpiLabel}>Total Work Orders</Text>
        </View>
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIcon, { backgroundColor: '#e8f5e9' }]}>
            <Ionicons name="people" size={20} color={Colors.success} />
          </View>
          <Text style={styles.kpiValue}>{summary?.activeOperators ?? '—'}</Text>
          <Text style={styles.kpiLabel}>Active Operators</Text>
        </View>
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIcon, { backgroundColor: '#fff3e0' }]}>
            <Ionicons name="checkmark-circle" size={20} color={Colors.warning} />
          </View>
          <Text style={styles.kpiValue}>{summary?.todayCompletedStages ?? '—'}</Text>
          <Text style={styles.kpiLabel}>Completed Today</Text>
        </View>
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIcon, { backgroundColor: '#ede7f6' }]}>
            <Ionicons name="speedometer" size={20} color={Colors.tertiary} />
          </View>
          <Text style={styles.kpiValue}>{efficiencyLabel}</Text>
          <Text style={styles.kpiLabel}>Avg Efficiency</Text>
        </View>
      </View>

      {/* Work Orders by Status */}
      <Text style={styles.sectionTitle}>Work Orders by Status</Text>
      <View style={styles.card}>
        {statusRows.length === 0 && (
          <Text style={styles.emptyText}>No work orders yet</Text>
        )}
        {statusRows.map((row) => (
          <View key={row.status} style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: StatusColors[row.status] || Colors.medium }]} />
            <Text style={styles.statusLabel}>{statusLabel(row.status)}</Text>
            <View style={styles.statusBarTrack}>
              <View
                style={[
                  styles.statusBarFill,
                  {
                    backgroundColor: StatusColors[row.status] || Colors.medium,
                    width: `${Math.max(4, (row.value / maxStatusCount) * 100)}%` as `${number}%`,
                  },
                ]}
              />
            </View>
            <Text style={styles.statusCount}>{row.value}</Text>
          </View>
        ))}
      </View>

      {/* Live Stage Status */}
      <Text style={styles.sectionTitle}>Live Stage Status</Text>
      <View style={styles.card}>
        {liveShown.length === 0 && (
          <Text style={styles.emptyText}>No active entries</Text>
        )}
        {liveShown.map((entry, idx) => (
          <View
            key={entry.id}
            style={[styles.liveRow, idx < liveShown.length - 1 && styles.liveRowBorder]}
          >
            <View style={styles.liveDot} />
            <View style={styles.liveInfo}>
              <Text style={styles.liveOperator} numberOfLines={1}>
                {[entry.user?.firstName, entry.user?.lastName].filter(Boolean).join(' ') || 'Operator'}
              </Text>
              <Text style={styles.liveDetail} numberOfLines={1}>
                {entry.workOrderStage?.workOrder?.orderNumber || '—'}
                {' · '}
                {entry.workOrderStage?.stage?.name || '—'}
                {entry.station?.name ? ` · ${entry.station.name}` : ''}
              </Text>
            </View>
            <Text style={styles.liveElapsed}>
              {formatDuration(elapsedSeconds(entry.startTime))}
            </Text>
          </View>
        ))}
        {liveOverflow > 0 && (
          <Text style={styles.moreText}>+{liveOverflow} more active</Text>
        )}
      </View>

      {/* My Day — the caller's own stats, computed server-side */}
      <Text style={styles.sectionTitle}>My Day</Text>
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{formatDuration(myDay?.trackedSeconds ?? 0)}</Text>
          <Text style={styles.statLabel}>Time Logged</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{myDay?.entriesCompleted ?? 0}</Text>
          <Text style={styles.statLabel}>Sessions Done</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{myDay?.workOrdersWorked ?? 0}</Text>
          <Text style={styles.statLabel}>Work Orders</Text>
        </View>
      </View>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('WorkOrders')}
        >
          <Ionicons name="clipboard" size={28} color={Colors.primary} />
          <Text style={styles.actionLabel}>Work Orders</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('Timer')}
        >
          <Ionicons name="timer" size={28} color={Colors.primary} />
          <Text style={styles.actionLabel}>Timer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('Projects')}
        >
          <Ionicons name="folder" size={28} color={Colors.primary} />
          <Text style={styles.actionLabel}>Projects</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    paddingTop: 60,
    paddingBottom: 32,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 20,
  },
  activeCard: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
  },
  activeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  activeCardTitle: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  activeTimer: {
    color: Colors.white,
    fontSize: 36,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  activeLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 12,
  },
  // ── KPI grid ──
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  kpiCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  kpiIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
  },
  kpiLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  // ── Shared card ──
  card: {
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
  // ── Status breakdown ──
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusLabel: {
    width: 92,
    fontSize: 13,
    color: Colors.text,
  },
  statusBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.light,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  statusBarFill: {
    height: 6,
    borderRadius: 3,
  },
  statusCount: {
    width: 32,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
  // ── Live status ──
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  liveRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
    marginRight: 10,
  },
  liveInfo: {
    flex: 1,
    marginRight: 8,
  },
  liveOperator: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  liveDetail: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  liveElapsed: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
    fontVariant: ['tabular-nums'],
  },
  moreText: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingTop: 8,
  },
  // ── My Day ──
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  actionButton: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  actionLabel: {
    fontSize: 12,
    color: Colors.text,
    marginTop: 8,
    fontWeight: '500',
  },
});
