import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, PriorityColors } from '../../theme/colors';
import { WorkOrder } from '../../types';
import { workOrderService } from '../../services/work-order.service';
import { offlineService } from '../../services/offline.service';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDate } from '../../utils/duration';
import { WorkOrdersStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<WorkOrdersStackParamList, 'WorkOrderList'>;

export function WorkOrderListScreen() {
  const navigation = useNavigation<Nav>();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    try {
      const data = await workOrderService.getAll();
      const list = Array.isArray(data) ? data : [];
      setOrders(list);
      offlineService.cacheWorkOrders(list);
    } catch {
      // Only use cache if offline
      if (!offlineService.isOnline) {
        const cached = await offlineService.getCachedWorkOrders();
        setOrders(cached as WorkOrder[]);
      } else {
        setOrders([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: WorkOrder }) => {
    const priorityColor = PriorityColors[item.priority] || Colors.medium;
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: priorityColor }]}
        onPress={() => navigation.navigate('WorkOrderDetail', { workOrderId: item.id })}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.orderNumber}>{item.orderNumber}</Text>
          <StatusBadge status={item.status} small />
        </View>
        <Text style={styles.productName}>{item.product?.name || 'Unknown Product'}</Text>
        <View style={styles.cardFooter}>
          <Text style={styles.quantity}>
            Qty: {item.completedQuantity}/{item.quantity}
          </Text>
          {item.dueDate && (
            <Text style={styles.dueDate}>Due: {formatDate(item.dueDate)}</Text>
          )}
        </View>
        <View style={styles.priorityRow}>
          <StatusBadge status={item.priority} small />
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading work orders...</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      data={orders}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyText}>No work orders found</Text>
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
  card: {
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  orderNumber: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  productName: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quantity: {
    fontSize: 13,
    color: Colors.text,
  },
  dueDate: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  priorityRow: {
    marginTop: 8,
  },
});
