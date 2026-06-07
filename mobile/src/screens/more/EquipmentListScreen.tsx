import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { Colors } from '../../theme/colors';
import { StatusBadge } from '../../components/StatusBadge';
import { equipmentService, Equipment } from '../../services/factory.service';

export function EquipmentListScreen() {
  const [items, setItems] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await equipmentService.getAll());
    } catch (err) {
      if (__DEV__) console.warn('Equipment load failed:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return <View style={styles.center}><Text style={styles.muted}>Loading equipment…</Text></View>;
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.title}>{item.code} · {item.name}</Text>
            <StatusBadge status={item.status} small />
          </View>
          <Text style={styles.subtitle}>{item.type || 'Equipment'}</Text>
        </View>
      )}
      ListEmptyComponent={<View style={styles.center}><Text style={styles.muted}>No equipment found</Text></View>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  muted: { color: Colors.textSecondary, fontSize: 14 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text, flexShrink: 1, marginRight: 8 },
  subtitle: { fontSize: 13, color: Colors.textSecondary },
});
