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
import { Colors } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../config/permissions';
import { timeTrackingService } from '../../services/time-tracking.service';
import {
  dashboardService,
  DashboardSummary,
  MyDayStats,
  QualityInsights,
} from '../../services/dashboard.service';
import { notificationsService } from '../../services/notifications.service';
import { TimeEntry } from '../../types';
import { formatDuration, formatTimer } from '../../utils/duration';
import { useSocketEvents } from '../../hooks/useSocketEvent';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 18) return 'Good Afternoon';
  return 'Good Evening';
}

/** First-pass-yield colour bands (fabrication: ≥95% is healthy, <85% poor). */
function fpyTone(rate: number | null): string {
  if (rate == null) return Colors.medium;
  if (rate >= 95) return Colors.success;
  if (rate >= 85) return Colors.warning;
  return Colors.danger;
}

const ATTENTION_TONES: Record<string, string> = {
  primary: Colors.primary,
  warning: Colors.warning,
  danger: Colors.danger,
};

interface AttentionItem {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'primary' | 'warning' | 'danger';
  label: string;
  onPress: () => void;
}

export function DashboardScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);

  // The home screen is action-first: the caller's own state (active timer, "my
  // day") + the things that need a response (attention queue) + the quality
  // health that the floor actually acts on — NOT the web portal's org-wide
  // management charts.
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [myDay, setMyDay] = useState<MyDayStats | null>(null);
  const [quality, setQuality] = useState<QualityInsights | null>(null);
  const [unread, setUnread] = useState(0);
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [now, setNow] = useState(Date.now());
  // Has the first fetch settled? Gates the timer slot + attention empty-state so
  // we never flash a false "not clocked in" / "all caught up" before data lands.
  const [loaded, setLoaded] = useState(false);

  // Role gating: the Quality section is only meaningful to inspectors / QC
  // authority. Computed once per render (reads the cached permission set).
  const canQuality = can('quality-analysis.view') || can('quality-reports.view');
  const canProjects = can('projects.view');
  const canWorkOrders = can('work-orders.view');
  const canTimer = can('time-tracking.view');
  // Scan lives inside the Work Orders / Projects stacks; target whichever tab
  // the user can actually see (navigating to a permission-hidden tab crashes).
  const scanStack = canWorkOrders ? 'WorkOrders' : canProjects ? 'Projects' : null;

  const loadData = useCallback(async () => {
    // Each section degrades independently — a failing widget shows "—" or
    // hides, never blanks the whole page (mirrors the web dashboard).
    const tasks = [
      dashboardService.getSummary(),
      dashboardService.getMyDay(),
      timeTrackingService.getActive(),
      notificationsService.unreadCount(),
      canQuality ? dashboardService.getQualityInsights() : Promise.resolve(null),
    ] as const;

    const [summaryRes, myDayRes, activeRes, unreadRes, qualityRes] =
      await Promise.allSettled(tasks);

    if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value);
    if (myDayRes.status === 'fulfilled') setMyDay(myDayRes.value);
    if (unreadRes.status === 'fulfilled') setUnread(unreadRes.value?.count ?? 0);
    if (qualityRes.status === 'fulfilled') setQuality(qualityRes.value);
    if (activeRes.status === 'fulfilled') {
      const mine = (activeRes.value ?? []).find(
        (e) => e.userId === user?.id && !e.endTime,
      );
      setActiveEntry(mine || null);
    }

    if (__DEV__) {
      [summaryRes, myDayRes, activeRes, unreadRes, qualityRes]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .forEach((r) => console.warn('Dashboard load failed:', r.reason));
    }
    setLoaded(true);
  }, [user?.id, canQuality]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time: refresh the moment anything relevant changes on any client —
  // including QC events so the attention queue stays live.
  useSocketEvents(
    [
      'dashboard-refresh',
      'time-entry-update',
      'stage-update',
      'work-order-update',
      'quality-alert',
      'notification',
    ],
    loadData,
  );

  // 30s polling safety-net in case socket events are missed.
  useEffect(() => {
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // 1s tick drives the active-timer card only when one is running.
  useEffect(() => {
    if (!activeEntry) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeEntry]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const elapsedSeconds = (startTime: string): number =>
    startTime ? Math.max(0, Math.floor((now - new Date(startTime).getTime()) / 1000)) : 0;

  // ── Derived production numbers (compact, current — not the full status chart) ──
  const statusCount = useCallback(
    (status: string): number => {
      const row = summary?.workOrdersByStatus?.find((r) => r.status === status);
      return row ? parseInt(row.count, 10) || 0 : 0;
    },
    [summary],
  );
  const inProgress = statusCount('in_progress');

  // ── Derived quality numbers ──
  const openNcrTotal = useMemo(
    () => Object.values(quality?.openNcrBySeverity ?? {}).reduce((s, n) => s + n, 0),
    [quality],
  );
  const overdueNcr = quality?.ncrAging?.over30 ?? 0;
  const pendingSignoffs = quality?.pendingSignoffs ?? 0;
  const mix = quality?.inspections30d;

  // ── The attention queue ──
  // Only surfaces items that have a TRUE mobile destination. Unread
  // notifications go to the Notifications feed — which is where NCR-raised /
  // failed-inspection alerts actually land. The standing QC counts (open NCRs,
  // pending sign-offs) are shown as health figures in the Quality card instead,
  // because there is no mobile list those counts could honestly deep-link to.
  const goNotifications = () => navigation.navigate('More', { screen: 'Notifications' });
  const attention = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    if (unread > 0) {
      items.push({
        key: 'notif',
        icon: 'notifications',
        tone: 'primary',
        label: `${unread} new notification${unread === 1 ? '' : 's'}`,
        onPress: goNotifications,
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      {/* Header: greeting + notification bell */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting} numberOfLines={1}>
            {getGreeting()}, {user?.firstName || 'Operator'}
          </Text>
          <Text style={styles.subGreeting}>Here's what needs you today.</Text>
        </View>
        <TouchableOpacity style={styles.bell} onPress={goNotifications} accessibilityLabel="Notifications">
          <Ionicons name="notifications-outline" size={24} color={Colors.text} />
          {unread > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Active timer hero — or an idle "clock in" prompt */}
      {activeEntry ? (
        <TouchableOpacity style={styles.activeCard} onPress={() => navigation.navigate('Timer')}>
          <View style={styles.activeCardHeader}>
            <Ionicons name="timer" size={20} color={Colors.white} />
            <Text style={styles.activeCardTitle}>Active Timer</Text>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" style={{ marginLeft: 'auto' }} />
          </View>
          <Text style={styles.activeTimer}>{formatTimer(elapsedSeconds(activeEntry.startTime))}</Text>
          <Text style={styles.activeLabel}>
            {activeEntry.workOrderStage?.stage?.name || 'Stage'}
            {activeEntry.workOrderStage?.workOrder?.orderNumber ? ` · ${activeEntry.workOrderStage.workOrder.orderNumber}` : ''}
          </Text>
        </TouchableOpacity>
      ) : loaded && canTimer ? (
        // Only after the first fetch settles — never flash "not clocked in" at a
        // user whose timer is in fact running.
        <TouchableOpacity style={styles.idleCard} onPress={() => navigation.navigate('Timer')}>
          <View style={[styles.idleIcon]}>
            <Ionicons name="timer-outline" size={22} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.idleTitle}>You're not clocked in</Text>
            <Text style={styles.idleSub}>Start a timer when you begin a stage</Text>
          </View>
          <Text style={styles.idleAction}>Start</Text>
        </TouchableOpacity>
      ) : null}

      {/* Needs attention — the action queue */}
      <Text style={styles.sectionTitle}>Needs attention</Text>
      <View style={styles.card}>
        {!loaded ? (
          <Text style={styles.checkingText}>Checking…</Text>
        ) : attention.length === 0 ? (
          <View style={styles.allClear}>
            <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
            <Text style={styles.allClearText}>You're all caught up</Text>
          </View>
        ) : (
          attention.map((item, idx) => (
            <TouchableOpacity
              key={item.key}
              style={[styles.attnRow, idx < attention.length - 1 && styles.attnRowBorder]}
              onPress={item.onPress}
            >
              <View style={[styles.attnIcon, { backgroundColor: `${ATTENTION_TONES[item.tone]}1a` }]}>
                <Ionicons name={item.icon} size={18} color={ATTENTION_TONES[item.tone]} />
              </View>
              <Text style={styles.attnLabel} numberOfLines={2}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.medium} />
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* My Day — the caller's own stats */}
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

      {/* Quality — FPY + 30-day mix + open work, role-gated */}
      {canQuality && (
        <>
          <Text style={styles.sectionTitle}>Quality</Text>
          <View style={styles.card}>
            <View style={styles.qualityTop}>
              <View style={styles.fpyBlock}>
                <Text style={[styles.fpyValue, { color: fpyTone(quality?.firstPassYield?.ratePct ?? null) }]}>
                  {quality?.firstPassYield?.ratePct != null ? `${quality.firstPassYield.ratePct}%` : '—'}
                </Text>
                <Text style={styles.fpyLabel}>First-pass yield</Text>
              </View>
              <View style={styles.qualityStats}>
                <View style={styles.qStat}>
                  <Text style={[styles.qStatValue, openNcrTotal > 0 && { color: Colors.danger }]}>{openNcrTotal}</Text>
                  <Text style={styles.qStatLabel}>Open NCRs</Text>
                  {overdueNcr > 0 && <Text style={styles.qStatSub}>{overdueNcr} overdue</Text>}
                </View>
                <View style={styles.qStat}>
                  <Text style={[styles.qStatValue, pendingSignoffs > 0 && { color: Colors.warning }]}>{pendingSignoffs}</Text>
                  <Text style={styles.qStatLabel}>To sign off</Text>
                </View>
              </View>
            </View>

            {/* 30-day pass / warn / fail mix */}
            {mix && mix.total > 0 ? (
              <View style={styles.mixBlock}>
                <View style={styles.mixBar}>
                  {mix.pass > 0 && <View style={{ flex: mix.pass, backgroundColor: Colors.success }} />}
                  {mix.warning > 0 && <View style={{ flex: mix.warning, backgroundColor: Colors.warning }} />}
                  {mix.fail > 0 && <View style={{ flex: mix.fail, backgroundColor: Colors.danger }} />}
                </View>
                <Text style={styles.mixLegend}>
                  Last 30 days · {mix.total} inspected · {mix.pass} pass · {mix.warning} warn · {mix.fail} fail
                </Text>
              </View>
            ) : (
              <Text style={styles.mixEmpty}>No inspections in the last 30 days</Text>
            )}
          </View>
        </>
      )}

      {/* Production today — compact, current numbers (not the full status chart) */}
      <Text style={styles.sectionTitle}>Production today</Text>
      <View style={styles.kpiGrid}>
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIcon, { backgroundColor: '#e8f5e9' }]}>
            <Ionicons name="checkmark-done" size={20} color={Colors.success} />
          </View>
          <Text style={styles.kpiValue}>{summary?.todayCompletedStages ?? '—'}</Text>
          <Text style={styles.kpiLabel}>Stages Completed</Text>
        </View>
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIcon, { backgroundColor: '#e3f2fd' }]}>
            <Ionicons name="construct" size={20} color={Colors.primary} />
          </View>
          <Text style={styles.kpiValue}>{summary ? inProgress : '—'}</Text>
          <Text style={styles.kpiLabel}>Orders In Progress</Text>
        </View>
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIcon, { backgroundColor: '#ede7f6' }]}>
            <Ionicons name="people" size={20} color={Colors.tertiary} />
          </View>
          <Text style={styles.kpiValue}>{summary?.activeOperators ?? '—'}</Text>
          <Text style={styles.kpiLabel}>Working Now</Text>
        </View>
      </View>

      {/* Quick Actions — role-filtered, scan-first for the floor */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsRow}>
        {scanStack && (
          <TouchableOpacity
            style={styles.actionButton}
            // `initial: false` seeds the stack's hub screen beneath Scan, so the
            // scanner gets a working back button (without it, Scan is the only
            // route in a freshly-focused tab → no way back from the camera).
            onPress={() => navigation.navigate(scanStack, { screen: 'Scan', initial: false })}
          >
            <Ionicons name="qr-code" size={26} color={Colors.primary} />
            <Text style={styles.actionLabel}>Scan</Text>
          </TouchableOpacity>
        )}
        {canWorkOrders && (
          <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('WorkOrders')}>
            <Ionicons name="clipboard" size={26} color={Colors.primary} />
            <Text style={styles.actionLabel}>Orders</Text>
          </TouchableOpacity>
        )}
        {canProjects && (
          <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Projects')}>
            <Ionicons name="folder" size={26} color={Colors.primary} />
            <Text style={styles.actionLabel}>Projects</Text>
          </TouchableOpacity>
        )}
        {canTimer && (
          <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Timer')}>
            <Ionicons name="timer" size={26} color={Colors.primary} />
            <Text style={styles.actionLabel}>Timer</Text>
          </TouchableOpacity>
        )}
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
  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
  },
  subGreeting: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  bell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  bellBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.danger,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: '700',
  },
  // ── Active timer hero ──
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
  // ── Idle (not clocked in) ──
  idleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  idleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e3f2fd',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  idleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  idleSub: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  idleAction: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
    marginLeft: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 12,
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
  // ── Attention queue ──
  checkingText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 6,
  },
  allClear: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  allClearText: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginLeft: 8,
  },
  attnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  attnRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  attnIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  attnLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
    marginRight: 8,
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
  // ── Quality ──
  qualityTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fpyBlock: {
    paddingRight: 16,
    marginRight: 16,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Colors.border,
  },
  fpyValue: {
    fontSize: 30,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  fpyLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  qualityStats: {
    flex: 1,
    flexDirection: 'row',
  },
  qStat: {
    flex: 1,
    alignItems: 'center',
  },
  qStatValue: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
  qStatLabel: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  qStatSub: {
    fontSize: 10.5,
    fontWeight: '700',
    color: Colors.danger,
    marginTop: 1,
  },
  mixBlock: {
    marginTop: 16,
  },
  mixBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: Colors.light,
  },
  mixLegend: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    marginTop: 8,
  },
  mixEmpty: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    marginTop: 14,
    textAlign: 'center',
  },
  // ── Production KPI grid ──
  kpiGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 14,
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
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
  },
  kpiLabel: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  // ── Quick actions ──
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  actionButton: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 10,
    paddingVertical: 18,
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
