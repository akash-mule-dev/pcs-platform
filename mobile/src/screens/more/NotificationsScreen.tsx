import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { WO } from '../../theme/wo';
import { notificationsService, MNotification } from '../../services/notifications.service';
import { useSocketEvent } from '../../hooks/useSocketEvent';

const PRIORITY_COLOR: Record<string, string> = {
  critical: WO.bad, high: WO.bad, medium: WO.warn, low: WO.textSoft,
};
function icon(type: string): keyof typeof Ionicons.glyphMap {
  if (type.startsWith('quality')) return 'shield-checkmark-outline';
  if (type.includes('overdue')) return 'alarm-outline';
  if (type.includes('work_order')) return 'clipboard-outline';
  return 'notifications-outline';
}
function fmt(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * In-app notification center — QC failures, NCR raises/lifecycle, overdue alerts.
 * Live via the `notification` socket event; tap marks read and (for a quality
 * report) deep-links into the report editor through the parent tab navigator.
 */
export function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<MNotification[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await notificationsService.list()); } catch { setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocketEvent('notification', () => { load(); });

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Notifications',
      headerRight: () => (
        <TouchableOpacity onPress={markAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.markAll}>Mark all read</Text>
        </TouchableOpacity>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  const markAll = async () => {
    setItems((cur) => cur?.map((n) => ({ ...n, isRead: true })) ?? cur);
    try { await notificationsService.markAllRead(); } catch { /* optimistic */ }
  };

  const onTap = async (n: MNotification) => {
    if (!n.isRead) {
      setItems((cur) => cur?.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) ?? cur);
      notificationsService.markRead(n.id).catch(() => {});
    }
    // Deep-link a QC report / NCR into the report editor (best-effort cross-tab nav).
    if (n.entityType === 'quality_report' && n.entityId) {
      try {
        navigation.navigate('WorkOrders', { screen: 'QcReportFill', params: { reportId: n.entityId, title: n.title } });
      } catch { /* stay on the list if nav target is unavailable */ }
    }
  };

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (items === null) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(n) => n.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      renderItem={({ item }) => (
        <TouchableOpacity style={[styles.row, !item.isRead && styles.rowUnread]} onPress={() => onTap(item)} activeOpacity={0.7}>
          <Ionicons name={icon(item.type)} size={20} color={PRIORITY_COLOR[item.priority] || Colors.primary} />
          <View style={styles.body}>
            <Text style={[styles.title, !item.isRead && styles.titleUnread]} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.msg} numberOfLines={2}>{item.message}</Text>
            <Text style={styles.time}>{fmt(item.createdAt)}</Text>
          </View>
          {!item.isRead && <View style={styles.dot} />}
        </TouchableOpacity>
      )}
      ListEmptyComponent={
        <View style={styles.center}><Ionicons name="notifications-off-outline" size={30} color={Colors.medium} /><Text style={styles.empty}>No notifications.</Text></View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WO.mist },
  list: { padding: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 50, gap: 8 },
  empty: { color: Colors.textSecondary, fontSize: 14 },
  markAll: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: WO.card, borderRadius: 12, borderWidth: 1, borderColor: WO.line, padding: 13, marginBottom: 10 },
  rowUnread: { borderColor: WO.accent, backgroundColor: '#fbfdff' },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '600', color: WO.text },
  titleUnread: { fontWeight: '800' },
  msg: { fontSize: 12.5, color: WO.textSoft, marginTop: 2, lineHeight: 17 },
  time: { fontSize: 11, color: WO.textSoft, marginTop: 4 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: WO.accent, marginTop: 4 },
});
