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
import { useRoute, useNavigation } from '@react-navigation/native';
import { NativeStackRouteProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, StatusColors } from '../../theme/colors';
import { WorkOrder, WorkOrderStage } from '../../types';
import { workOrderService } from '../../services/work-order.service';
import { timeTrackingService } from '../../services/time-tracking.service';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDate, formatDuration } from '../../utils/duration';
import { WorkOrdersStackParamList } from '../../navigation/types';

type Route = NativeStackRouteProp<WorkOrdersStackParamList, 'WorkOrderDetail'>;

const stageIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  pending: 'ellipse-outline',
  in_progress: 'play-circle',
  completed: 'checkmark-circle',
  skipped: 'remove-circle',
};

export function WorkOrderDetailScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<any>();
  const { workOrderId } = route.params;
  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadOrder = useCallback(async () => {
    try {
      const data = await workOrderService.getById(workOrderId);
      setOrder(data);
    } catch {
      Alert.alert('Error', 'Failed to load work order');
    }
  }, [workOrderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadOrder();
    setRefreshing(false);
  };

  const handleStageAction = (stage: WorkOrderStage) => {
    const actions: { text: string; onPress: () => void; style?: 'cancel' | 'destructive' }[] = [];

    if (stage.status === 'pending' || stage.status === 'in_progress') {
      actions.push({
        text: 'Clock In',
        onPress: async () => {
          try {
            await timeTrackingService.clockIn(stage.id);
            if (stage.status === 'pending') {
              await workOrderService.updateStageStatus(workOrderId, stage.id, 'in_progress');
            }
            navigation.navigate('Timer');
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to clock in');
          }
        },
      });
    }

    if (stage.status === 'pending') {
      actions.push({
        text: 'Skip Stage',
        onPress: async () => {
          try {
            await workOrderService.updateStageStatus(workOrderId, stage.id, 'skipped');
            loadOrder();
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to skip stage');
          }
        },
      });
    }

    if (stage.status === 'in_progress') {
      actions.push({
        text: 'Mark Complete',
        onPress: async () => {
          try {
            await workOrderService.updateStageStatus(workOrderId, stage.id, 'completed');
            loadOrder();
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to complete stage');
          }
        },
      });
    }

    actions.push({ text: 'Cancel', onPress: () => {}, style: 'cancel' });

    Alert.alert('Stage Actions', `${stage.stage?.name || 'Stage'}`, actions);
  };

  if (!order) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const sortedStages = [...(order.stages || [])].sort(
    (a, b) => (a.stage?.sequence ?? 0) - (b.stage?.sequence ?? 0),
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.orderNumber}>{order.orderNumber}</Text>
        <StatusBadge status={order.status} />
      </View>

      {/* Info Card */}
      <View style={styles.card}>
        <InfoRow label="Product" value={order.product?.name || '—'} />
        <InfoRow label="Process" value={order.process?.name || '—'} />
        <InfoRow label="Line" value={order.line?.name || 'Unassigned'} />
        <InfoRow
          label="Quantity"
          value={`${order.completedQuantity} / ${order.quantity}`}
        />
        <InfoRow label="Due Date" value={formatDate(order.dueDate)} />
        <InfoRow label="Priority" value={order.priority.toUpperCase()} />
      </View>

      {/* Stages */}
      <Text style={styles.sectionTitle}>Stages</Text>
      {sortedStages.map((stage) => {
        const iconName = stageIcons[stage.status] || 'ellipse-outline';
        const iconColor = StatusColors[stage.status] || Colors.medium;
        return (
          <TouchableOpacity
            key={stage.id}
            style={styles.stageItem}
            onPress={() => handleStageAction(stage)}
            disabled={stage.status === 'completed' || stage.status === 'skipped'}
          >
            <Ionicons name={iconName} size={24} color={iconColor} style={styles.stageIcon} />
            <View style={styles.stageInfo}>
              <Text style={styles.stageName}>
                {stage.stage?.sequence}. {stage.stage?.name || 'Stage'}
              </Text>
              <Text style={styles.stageDetail}>
                Target: {formatDuration(stage.stage?.targetTimeSeconds)}
                {stage.actualTimeSeconds
                  ? ` | Actual: ${formatDuration(stage.actualTimeSeconds)}`
                  : ''}
              </Text>
            </View>
            <StatusBadge status={stage.status} small />
          </TouchableOpacity>
        );
      })}
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
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  orderNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  infoLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 12,
  },
  stageItem: {
    flexDirection: 'row',
    alignItems: 'center',
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
  stageIcon: {
    marginRight: 12,
  },
  stageInfo: {
    flex: 1,
  },
  stageName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  stageDetail: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
});
