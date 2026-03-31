import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { Colors } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { timeTrackingService } from '../../services/time-tracking.service';
import { TimeEntry } from '../../types';
import { formatDuration } from '../../utils/duration';

export function ProfileScreen() {
  const { user, logout } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [weekStats, setWeekStats] = useState({
    stagesCompleted: 0,
    avgTimePerStage: 0,
    efficiency: 0,
  });

  const loadStats = useCallback(async () => {
    try {
      const entries = await timeTrackingService.getHistory();
      const list: TimeEntry[] = Array.isArray(entries) ? entries : [];

      // Filter to current week and current user
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const myEntries = list.filter(
        (e) =>
          e.userId === user?.id &&
          e.endTime &&
          new Date(e.startTime) >= weekAgo,
      );

      const stagesCompleted = myEntries.length;
      const totalTime = myEntries.reduce(
        (sum, e) => sum + (e.durationSeconds || 0),
        0,
      );
      const avgTimePerStage =
        stagesCompleted > 0 ? Math.round(totalTime / stagesCompleted) : 0;

      // Efficiency: avg of (target / actual) for entries with targets
      let efficiencySum = 0;
      let efficiencyCount = 0;
      for (const entry of myEntries) {
        const target = entry.workOrderStage?.stage?.targetTimeSeconds;
        const actual = entry.durationSeconds;
        if (target && actual && actual > 0) {
          efficiencySum += target / actual;
          efficiencyCount++;
        }
      }
      const efficiency =
        efficiencyCount > 0
          ? Math.round((efficiencySum / efficiencyCount) * 100)
          : 0;

      setWeekStats({ stagesCompleted, avgTimePerStage, efficiency });
    } catch {
      // silently fail
    }
  }, [user?.id]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout },
    ]);
  };

  const initials =
    `${user?.firstName?.charAt(0) || ''}${user?.lastName?.charAt(0) || ''}`.toUpperCase() ||
    '?';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.userName}>
          {user?.firstName} {user?.lastName}
        </Text>
        <Text style={styles.userRole}>
          {user?.role?.name
            ? user.role.name.charAt(0).toUpperCase() + user.role.name.slice(1)
            : 'Operator'}
        </Text>
      </View>

      {/* Info Card */}
      <View style={styles.card}>
        <InfoRow label="Employee ID" value={user?.employeeId || '—'} />
        <InfoRow label="Email" value={user?.email || '—'} />
        <InfoRow label="Badge ID" value={user?.badgeId || '—'} />
      </View>

      {/* Week Stats */}
      <Text style={styles.sectionTitle}>This Week</Text>
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{weekStats.stagesCompleted}</Text>
          <Text style={styles.statLabel}>Stages Done</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {formatDuration(weekStats.avgTimePerStage)}
          </Text>
          <Text style={styles.statLabel}>Avg / Stage</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{weekStats.efficiency}%</Text>
          <Text style={styles.statLabel}>Efficiency</Text>
        </View>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
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
  avatarWrap: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    color: Colors.white,
    fontSize: 28,
    fontWeight: '700',
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
  },
  userRole: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
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
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  infoLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
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
    marginBottom: 32,
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
  logoutButton: {
    height: 50,
    backgroundColor: Colors.danger,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
