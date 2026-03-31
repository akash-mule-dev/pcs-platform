import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  RefreshControl,
} from 'react-native';
import { Colors } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { timeTrackingService } from '../../services/time-tracking.service';
import { TimeEntry } from '../../types';
import { formatDuration, formatDateGroup } from '../../utils/duration';

interface Section {
  title: string;
  data: TimeEntry[];
}

export function HistoryScreen() {
  const { user } = useAuth();
  const [sections, setSections] = useState<Section[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const entries = await timeTrackingService.getHistory();
      const list = (Array.isArray(entries) ? entries : []).filter(
        (e) => e.userId === user?.id && e.endTime,
      );

      // Group by date
      const groups = new Map<string, TimeEntry[]>();
      for (const entry of list) {
        const key = new Date(entry.startTime).toDateString();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(entry);
      }

      const sectionData: Section[] = [];
      for (const [dateKey, entries] of groups) {
        sectionData.push({
          title: formatDateGroup(dateKey),
          data: entries.sort(
            (a, b) =>
              new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
          ),
        });
      }

      // Sort sections descending
      sectionData.sort(
        (a, b) =>
          new Date(b.data[0].startTime).getTime() -
          new Date(a.data[0].startTime).getTime(),
      );

      setSections(sectionData);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHistory();
    setRefreshing(false);
  };

  const getVariance = (entry: TimeEntry): { text: string; color: string } | null => {
    const target = entry.workOrderStage?.stage?.targetTimeSeconds;
    const actual = entry.durationSeconds;
    if (!target || !actual) return null;

    const pct = Math.round(((actual - target) / target) * 100);
    let color = Colors.primary;
    if (pct <= -10) color = Colors.success;
    else if (pct > 10) color = Colors.danger;

    const sign = pct > 0 ? '+' : '';
    return { text: `${sign}${pct}%`, color };
  };

  const renderItem = ({ item }: { item: TimeEntry }) => {
    const variance = getVariance(item);
    return (
      <View style={styles.entryCard}>
        <View style={styles.entryRow}>
          <View style={styles.entryInfo}>
            <Text style={styles.entryStage}>
              {item.workOrderStage?.stage?.name || 'Stage'}
            </Text>
            <Text style={styles.entryOrder}>
              {item.workOrderStage?.workOrder?.orderNumber || ''}
            </Text>
          </View>
          <View style={styles.entryRight}>
            <Text style={styles.entryDuration}>
              {formatDuration(item.durationSeconds)}
            </Text>
            {variance && (
              <Text style={[styles.entryVariance, { color: variance.color }]}>
                {variance.text}
              </Text>
            )}
          </View>
        </View>
        {item.notes && <Text style={styles.entryNotes}>{item.notes}</Text>}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading history...</Text>
      </View>
    );
  }

  return (
    <SectionList
      style={styles.container}
      contentContainerStyle={styles.list}
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      renderSectionHeader={({ section }) => (
        <Text style={styles.sectionHeader}>{section.title}</Text>
      )}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyText}>No time entries yet</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  list: {
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 8,
    marginTop: 12,
  },
  entryCard: {
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  entryInfo: {
    flex: 1,
  },
  entryStage: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  entryOrder: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  entryRight: {
    alignItems: 'flex-end',
  },
  entryDuration: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  entryVariance: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  entryNotes: {
    fontSize: 13,
    color: Colors.medium,
    marginTop: 8,
    fontStyle: 'italic',
  },
});
