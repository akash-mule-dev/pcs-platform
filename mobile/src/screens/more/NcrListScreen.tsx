import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { StatusBadge } from '../../components/StatusBadge';
import { ncrService, Ncr } from '../../services/factory.service';
import { MoreStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<MoreStackParamList, 'NcrList'>;

export function NcrListScreen() {
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<Ncr[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await ncrService.getAll());
    } catch (err) {
      if (__DEV__) console.warn('NCR load failed:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload on focus so a newly-raised NCR appears when returning from the form.
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return <View style={styles.center}><Text style={styles.muted}>Loading NCRs…</Text></View>;
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      ListHeaderComponent={
        <TouchableOpacity style={styles.raiseBtn} onPress={() => navigation.navigate('NcrCreate')}>
          <Ionicons name="add-circle" size={20} color={Colors.white} />
          <Text style={styles.raiseText}>Raise NCR</Text>
        </TouchableOpacity>
      }
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('NcrDetail', { id: item.id })}>
          <View style={styles.cardHeader}>
            <Text style={styles.title}>{item.number || 'NCR'}</Text>
            <StatusBadge status={item.status} small />
          </View>
          {!!item.title && <Text style={styles.subtitle}>{item.title}</Text>}
          <View style={styles.footer}>
            {!!item.severity && <StatusBadge status={item.severity} small />}
            {!!item.disposition && <Text style={styles.muted}>{item.disposition}</Text>}
          </View>
        </TouchableOpacity>
      )}
      ListEmptyComponent={<View style={styles.center}><Text style={styles.muted}>No NCRs yet — tap “Raise NCR” to log one.</Text></View>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  muted: { color: Colors.textSecondary, fontSize: 14 },
  raiseBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, marginBottom: 14 },
  raiseText: { color: Colors.white, fontWeight: '700', fontSize: 15 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: Colors.danger,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 16, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginBottom: 8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
});
