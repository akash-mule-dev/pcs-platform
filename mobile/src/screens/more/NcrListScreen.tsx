import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { StatusBadge } from '../../components/StatusBadge';
import { ncrService, Ncr } from '../../services/factory.service';
import { can } from '../../config/permissions';
import { MoreStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<MoreStackParamList, 'NcrList'>;

const FILTERS: { key: string; label: string }[] = [
  { key: 'open-any', label: 'Open' },
  { key: 'investigation', label: 'Investigating' },
  { key: 'disposition', label: 'Disposition' },
  { key: 'closed', label: 'Closed' },
  { key: '', label: 'All' },
];

export function NcrListScreen() {
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<Ncr[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('open-any');
  const canCreate = can('ncr.create');

  const load = useCallback(async (f = filter) => {
    try {
      const params: Record<string, string> = {};
      if (f === 'open-any') params.open = 'true';
      else if (f) params.status = f;
      setItems(await ncrService.getAll(params));
    } catch (err) {
      if (__DEV__) console.warn('NCR load failed:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Reload on focus so a newly-raised NCR appears when returning from the form.
  useEffect(() => navigation.addListener('focus', () => load()), [navigation, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const pickFilter = (key: string) => {
    setFilter(key);
    setLoading(true);
    load(key);
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
        <View>
          {canCreate && (
            <TouchableOpacity style={styles.raiseBtn} onPress={() => navigation.navigate('NcrCreate')}>
              <Ionicons name="add-circle" size={20} color={Colors.white} />
              <Text style={styles.raiseText}>Raise NCR</Text>
            </TouchableOpacity>
          )}
          <View style={styles.chipRow}>
            {FILTERS.map((f) => (
              <TouchableOpacity
                key={f.key || 'all'}
                style={[styles.chip, filter === f.key && styles.chipActive]}
                onPress={() => pickFilter(f.key)}
              >
                <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('NcrDetail', { id: item.id })}>
          <View style={styles.cardHeader}>
            <Text style={styles.title}>{item.number || 'NCR'}</Text>
            <StatusBadge status={item.status} small />
          </View>
          {!!item.title && <Text style={styles.subtitle}>{item.title}</Text>}
          {(item.projectName || item.itemMark) ? (
            <Text style={styles.context}>
              {item.projectName ?? ''}{item.projectName && item.itemMark ? ' · ' : ''}{item.itemMark ?? ''}
            </Text>
          ) : null}
          <View style={styles.footer}>
            {!!item.severity && <StatusBadge status={item.severity} small />}
            {!!item.disposition && <Text style={styles.muted}>{item.disposition.replace(/_/g, ' ')}</Text>}
          </View>
        </TouchableOpacity>
      )}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.muted}>
            {filter ? 'No NCRs match this filter.' : 'No NCRs yet — tap “Raise NCR” to log one.'}
          </Text>
        </View>
      }
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  chip: { borderWidth: 1, borderColor: Colors.border, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 13, backgroundColor: Colors.card },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 12.5, color: Colors.text },
  chipTextActive: { color: Colors.white, fontWeight: '600' },
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
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginBottom: 4 },
  context: { fontSize: 12.5, color: Colors.textSecondary, marginBottom: 8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
});
