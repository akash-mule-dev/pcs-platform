import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  RefreshControl,
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
import { formatTimer, formatDuration } from '../../utils/duration';
import { TimeTrackingStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<TimeTrackingStackParamList, 'TimerMain'>;

export function TimerScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [notes, setNotes] = useState('');
  const [pendingStages, setPendingStages] = useState<
    { stage: WorkOrderStage; orderNumber: string }[]
  >([]);
  const [refreshing, setRefreshing] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  const loadState = useCallback(async () => {
    try {
      const activeEntries = await timeTrackingService.getActive();
      const myActive = activeEntries.find(
        (e) => e.userId === user?.id && !e.endTime,
      );
      setActiveEntry(myActive || null);

      if (!myActive) {
        // Load pending stages to clock into
        // The list endpoint doesn't include stages, so fetch each WO detail
        const orders = await workOrderService.getAll({ status: 'in_progress' });
        const orderList = Array.isArray(orders) ? orders : [];
        const stages: { stage: WorkOrderStage; orderNumber: string }[] = [];
        for (const order of orderList) {
          const detail = await workOrderService.getById(order.id);
          for (const s of detail.stages || []) {
            if (s.status === 'pending' || s.status === 'in_progress') {
              stages.push({ stage: s, orderNumber: detail.orderNumber });
            }
          }
        }
        setPendingStages(stages);
      }
    } catch {
      // Use cached
    }
  }, [user?.id]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Timer tick
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (!activeEntry) {
      setElapsed(0);
      return;
    }
    const start = new Date(activeEntry.startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    tickRef.current = setInterval(tick, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [activeEntry]);

  const handleClockIn = async (stageId: string) => {
    try {
      if (offlineService.isOnline) {
        await timeTrackingService.clockIn(stageId);
      } else {
        await offlineService.queueAction('clock-in', { workOrderStageId: stageId });
        Alert.alert('Queued', 'Clock-in queued for sync when online');
      }
      loadState();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to clock in');
    }
  };

  const handleClockOut = async () => {
    if (!activeEntry) return;
    setClockingOut(true);
    try {
      if (offlineService.isOnline) {
        await timeTrackingService.clockOut(activeEntry.id, notes || undefined);
      } else {
        await offlineService.queueAction('clock-out', {
          timeEntryId: activeEntry.id,
          notes: notes || undefined,
        });
        Alert.alert('Queued', 'Clock-out queued for sync when online');
      }
      setNotes('');
      setActiveEntry(null);
      loadState();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to clock out');
    } finally {
      setClockingOut(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadState();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      {/* History button */}
      <TouchableOpacity
        style={styles.historyButton}
        onPress={() => navigation.navigate('History')}
      >
        <Ionicons name="time-outline" size={18} color={Colors.primary} />
        <Text style={styles.historyButtonText}>View History</Text>
      </TouchableOpacity>

      {activeEntry ? (
        /* ── Active Timer ── */
        <View style={styles.timerSection}>
          <Text style={styles.stageName}>
            {activeEntry.workOrderStage?.stage?.name || 'Stage'}
          </Text>
          <Text style={styles.orderNumber}>
            {activeEntry.workOrderStage?.workOrder?.orderNumber || ''}
          </Text>

          <View style={styles.timerCircle}>
            <Text style={styles.timerText}>{formatTimer(elapsed)}</Text>
          </View>

          {activeEntry.workOrderStage?.stage?.targetTimeSeconds && (
            <Text style={styles.targetText}>
              Target: {formatDuration(activeEntry.workOrderStage.stage.targetTimeSeconds)}
            </Text>
          )}

          <TextInput
            style={styles.notesInput}
            placeholder="Add notes (optional)"
            placeholderTextColor={Colors.medium}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
          />

          <TouchableOpacity
            style={[styles.clockOutButton, clockingOut && styles.buttonDisabled]}
            onPress={handleClockOut}
            disabled={clockingOut}
          >
            <Ionicons name="stop-circle" size={22} color={Colors.white} />
            <Text style={styles.clockOutText}>
              {clockingOut ? 'Stopping...' : 'Clock Out'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* ── No Active Timer ── */
        <View style={styles.pendingSection}>
          <Text style={styles.pendingTitle}>Clock In to a Stage</Text>
          <Text style={styles.pendingSubtitle}>
            Select a stage from your active work orders
          </Text>

          {pendingStages.length === 0 ? (
            <Text style={styles.emptyText}>No pending stages available</Text>
          ) : (
            pendingStages.map(({ stage, orderNumber }) => (
              <TouchableOpacity
                key={stage.id}
                style={styles.stageCard}
                onPress={() => handleClockIn(stage.id)}
              >
                <View style={styles.stageCardInfo}>
                  <Text style={styles.stageCardName}>
                    {stage.stage?.name || 'Stage'}
                  </Text>
                  <Text style={styles.stageCardOrder}>{orderNumber}</Text>
                  {stage.stage?.targetTimeSeconds && (
                    <Text style={styles.stageCardTarget}>
                      Target: {formatDuration(stage.stage.targetTimeSeconds)}
                    </Text>
                  )}
                </View>
                <Ionicons name="play-circle" size={32} color={Colors.success} />
              </TouchableOpacity>
            ))
          )}
        </View>
      )}
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
  },
  historyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginBottom: 16,
  },
  historyButtonText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  // ── Active Timer ──
  timerSection: {
    alignItems: 'center',
  },
  stageName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  orderNumber: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 24,
  },
  timerCircle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    marginBottom: 20,
  },
  timerText: {
    fontSize: 48,
    fontWeight: '700',
    color: Colors.white,
    fontVariant: ['tabular-nums'],
  },
  targetText: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 24,
  },
  notesInput: {
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: Colors.white,
    textAlignVertical: 'top',
    minHeight: 80,
    marginBottom: 20,
  },
  clockOutButton: {
    width: '100%',
    maxWidth: 400,
    height: 56,
    backgroundColor: Colors.danger,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  clockOutText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  // ── Pending Stages ──
  pendingSection: {
    alignItems: 'center',
  },
  pendingTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  pendingSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.medium,
    marginTop: 20,
  },
  stageCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  stageCardInfo: {
    flex: 1,
  },
  stageCardName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  stageCardOrder: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  stageCardTarget: {
    fontSize: 12,
    color: Colors.medium,
    marginTop: 2,
  },
});
