import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { Colors } from '../../theme/colors';
import { materialsService, Material } from '../../services/factory.service';

export function MaterialListScreen() {
  const [items, setItems] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await materialsService.getAll());
    } catch (err) {
      if (__DEV__) console.warn('Materials load failed:', err);
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
    return <View style={styles.center}><Text style={styles.muted}>Loading materials…</Text></View>;
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
            <Text style={styles.title}>{item.code}</Text>
            {!!item.type && <Text style={styles.tag}>{item.type}</Text>}
          </View>
          <Text style={styles.subtitle}>{item.name}</Text>
          <View style={styles.footer}>
            {!!item.unitOfMeasure && <Text style={styles.muted}>UoM: {item.unitOfMeasure}</Text>}
            {item.reorderLevel != null && <Text style={styles.muted}>Reorder ≤ {item.reorderLevel}</Text>}
          </View>
        </View>
      )}
      ListEmptyComponent={<View style={styles.center}><Text style={styles.muted}>No materials found</Text></View>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 16, fontWeight: '700', color: Colors.text },
  tag: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    backgroundColor: Colors.light,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    textTransform: 'uppercase',
  },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginBottom: 8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
