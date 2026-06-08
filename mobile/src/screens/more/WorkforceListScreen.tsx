import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { Colors } from '../../theme/colors';
import { skillsService, Skill } from '../../services/factory.service';

export function WorkforceListScreen() {
  const [items, setItems] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await skillsService.getAll());
    } catch (err) {
      if (__DEV__) console.warn('Skills load failed:', err);
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
    return <View style={styles.center}><Text style={styles.muted}>Loading skills…</Text></View>;
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(i) => i.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.title}>{item.code ? item.code + ' · ' : ''}{item.name}</Text>
          {!!item.category && <Text style={styles.subtitle}>{item.category}</Text>}
        </View>
      )}
      ListEmptyComponent={<View style={styles.center}><Text style={styles.muted}>No skills defined</Text></View>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  muted: { color: Colors.textSecondary, fontSize: 14 },
  card: { backgroundColor: Colors.white, borderRadius: 10, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
});
