import React, { useCallback, useEffect, useState } from 'react';
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
import { timeTrackingService } from '../../services/time-tracking.service';
import { TimeEntry } from '../../types';
import { formatDuration, formatTimer } from '../../utils/duration';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 18) return 'Good Afternoon';
  return 'Good Evening';
}

export function DashboardScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [todayStats, setTodayStats] = useState({
    completedCount: 0,
    totalTimeSeconds: 0,
    workOrderCount: 0,
  });
  const [elapsed, setElapsed] = useState(0);

  const loadData = useCallback(async () => {
    try {
      const [activeEntries, history] = await Promise.all([
        timeTrackingService.getActive(),
        timeTrackingService.getHistory(),
      ]);

      // Find current user's active entry
      const myActive = activeEntries.find(
        (e) => e.userId === user?.id && !e.endTime,
      );
      setActiveEntry(myActive || null);

      // Calculate today's stats
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEntries = (Array.isArray(history) ? history : []).filter(
        (e) =>
          e.userId === user?.id &&
          new Date(e.startTime) >= todayStart &&
          e.endTime,
      );

      const completedCount = todayEntries.length;
      const totalTimeSeconds = todayEntries.reduce(
        (sum, e) => sum + (e.durationSeconds || 0),
        0,
      );
      const workOrderIds = new Set(
        todayEntries
          .map((e) => e.workOrderStage?.workOrder?.id)
          .filter(Boolean),
      );

      setTodayStats({
        completedCount,
        totalTimeSeconds,
        workOrderCount: workOrderIds.size,
      });
    } catch {
      // silently fail on refresh
    }
  }, [user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Elapsed timer for active entry
  useEffect(() => {
    if (!activeEntry) {
      setElapsed(0);
      return;
    }
    const start = new Date(activeEntry.startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeEntry]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

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
          <Text style={styles.activeTimer}>{formatTimer(elapsed)}</Text>
          <Text style={styles.activeLabel}>
            {activeEntry.workOrderStage?.stage?.name || 'Stage'} -{' '}
            {activeEntry.workOrderStage?.workOrder?.orderNumber || ''}
          </Text>
        </TouchableOpacity>
      )}

      {/* Today's Stats */}
      <Text style={styles.sectionTitle}>Today's Stats</Text>
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{todayStats.completedCount}</Text>
          <Text style={styles.statLabel}>Stages Done</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {formatDuration(todayStats.totalTimeSeconds)}
          </Text>
          <Text style={styles.statLabel}>Total Time</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{todayStats.workOrderCount}</Text>
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
          onPress={() => navigation.navigate('Models')}
        >
          <Ionicons name="cube" size={28} color={Colors.primary} />
          <Text style={styles.actionLabel}>3D Models</Text>
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
    fontSize: 20,
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
