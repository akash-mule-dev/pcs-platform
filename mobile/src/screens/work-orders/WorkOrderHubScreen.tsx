import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { WorkOrdersStackParamList } from '../../navigation/types';
import { ordersService, MOrdersDashboard, MDashboardOrder, OrderStatusColors, OrderStatusLabels } from '../../services/projects.service';

type Nav = NativeStackNavigationProp<WorkOrdersStackParamList, 'WorkOrderHub'>;
type Filter = 'all' | 'active' | 'late' | 'holds' | 'completed';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'late', label: 'Late' },
  { key: 'holds', label: 'NCR' },
  { key: 'completed', label: 'Done' },
];

/**
 * Work-orders hub: every production run across all projects with live
 * progress. Tap an order to open its audit dashboard (stages → assemblies).
 */
export function WorkOrderHubScreen() {
  const navigation = useNavigation<Nav>();
  const [data, setData] = useState<MOrdersDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.navigate('WorkOrderList')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 13 }}>Product orders</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const load = useCallback(async () => {
    try { setData(await ordersService.dashboard()); }
    catch { setData(null); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const counts = useMemo(() => {
    const rows = data?.orders ?? [];
    return {
      all: rows.length,
      active: rows.filter((o) => o.status === 'planned' || o.status === 'in_progress').length,
      late: rows.filter((o) => o.late).length,
      holds: rows.filter((o) => o.openNcrs > 0).length,
      completed: rows.filter((o) => o.status === 'completed').length,
    } as Record<Filter, number>;
  }, [data]);

  const visible = useMemo(() => {
    let rows = data?.orders ?? [];
    switch (filter) {
      case 'active': rows = rows.filter((o) => o.status === 'planned' || o.status === 'in_progress'); break;
      case 'late': rows = rows.filter((o) => o.late); break;
      case 'holds': rows = rows.filter((o) => o.openNcrs > 0); break;
      case 'completed': rows = rows.filter((o) => o.status === 'completed'); break;
    }
    const term = query.trim().toLowerCase();
    if (term) {
      rows = rows.filter((o) =>
        o.number.toLowerCase().includes(term)
        || o.project.name.toLowerCase().includes(term)
        || (o.customerName ?? '').toLowerCase().includes(term));
    }
    return rows;
  }, [data, filter, query]);

  const Header = (
    <View>
      {data && (
        <View style={styles.kpis}>
          <View style={styles.kpi}><Text style={styles.kpiNum}>{counts.active}</Text><Text style={styles.kpiLbl}>Active</Text></View>
          <View style={styles.kpi}>
            <Text style={styles.kpiNum}>{data.kpis.unitsDone}<Text style={styles.kpiDim}>/{data.kpis.unitsTotal}</Text></Text>
            <Text style={styles.kpiLbl}>Units done</Text>
          </View>
          <View style={[styles.kpi, counts.late > 0 && styles.kpiBad]}><Text style={[styles.kpiNum, counts.late > 0 && styles.kpiNumBad]}>{counts.late}</Text><Text style={styles.kpiLbl}>Late</Text></View>
          <View style={[styles.kpi, data.kpis.openNcrs > 0 && styles.kpiBad]}><Text style={[styles.kpiNum, data.kpis.openNcrs > 0 && styles.kpiNumBad]}>{data.kpis.openNcrs}</Text><Text style={styles.kpiLbl}>NCRs</Text></View>
        </View>
      )}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search order, project, customer…"
          placeholderTextColor={Colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
        {!!query && <TouchableOpacity onPress={() => setQuery('')}><Ionicons name="close-circle" size={16} color={Colors.textSecondary} /></TouchableOpacity>}
      </View>
      <View style={styles.chips}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <TouchableOpacity key={f.key} style={[styles.chip, on && styles.chipOn]} onPress={() => setFilter(on ? 'all' : f.key)}>
              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{f.label}</Text>
              <View style={[styles.cBadge, on && styles.cBadgeOn]}><Text style={[styles.cBadgeTxt, on && styles.cBadgeTxtOn]}>{counts[f.key]}</Text></View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderCard = ({ item }: { item: MDashboardOrder }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('OrderBoard', { orderId: item.id, projectId: item.project.id, orderNumber: item.number })}
    >
      <View style={styles.cardTop}>
        <Text style={styles.num}>{item.number}</Text>
        {item.late && <View style={styles.lateChip}><Ionicons name="time-outline" size={11} color="#b45309" /><Text style={styles.lateTxt}>late</Text></View>}
        {item.openNcrs > 0 && <View style={styles.ncrChip}><Text style={styles.ncrTxt}>{item.openNcrs} NCR</Text></View>}
        <View style={[styles.statusChip, { backgroundColor: OrderStatusColors[item.status] || Colors.medium }]}>
          <Text style={styles.statusTxt}>{OrderStatusLabels[item.status] || item.status}</Text>
        </View>
      </View>
      <Text style={styles.proj} numberOfLines={1}>
        {item.project.name}{item.customerName ? `  ·  ${item.customerName}` : ''}  ·  Qty {item.quantity}
      </Text>
      <View style={styles.progRow}>
        <View style={styles.track}><View style={[styles.fill, item.percent >= 100 && styles.fillDone, { width: `${Math.min(100, item.percent)}%` as any }]} /></View>
        <Text style={styles.pct}>{Math.round(item.percent)}%</Text>
      </View>
      <Text style={styles.meta}>
        {item.itemsDone}/{item.items} assemblies · {item.unitsDone}/{item.unitsTotal} units
        {item.dueDate ? ` · due ${new Date(item.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
      </Text>
    </TouchableOpacity>
  );

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      data={visible}
      keyExtractor={(i) => i.id}
      ListHeaderComponent={Header}
      renderItem={renderCard}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="receipt-outline" size={36} color={Colors.medium} />
          <Text style={styles.muted}>{query || filter !== 'all' ? 'No work orders match.' : 'No work orders yet — open a project and create one.'}</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { padding: 32, alignItems: 'center', gap: 8 },
  muted: { color: Colors.textSecondary, textAlign: 'center' },

  kpis: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  kpi: { flex: 1, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingVertical: 10, alignItems: 'center' },
  kpiBad: { borderColor: '#f4c7c3' },
  kpiNum: { fontSize: 17, fontWeight: '800', color: Colors.text },
  kpiNumBad: { color: Colors.danger },
  kpiDim: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' },
  kpiLbl: { fontSize: 10.5, color: Colors.textSecondary, marginTop: 1 },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10, marginBottom: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.light, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 11, borderWidth: 1, borderColor: Colors.border },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipTxt: { color: Colors.text, fontSize: 12.5, fontWeight: '600' },
  chipTxtOn: { color: Colors.white },
  cBadge: { backgroundColor: Colors.card, borderRadius: 9, minWidth: 18, paddingHorizontal: 5, alignItems: 'center' },
  cBadgeOn: { backgroundColor: 'rgba(255,255,255,0.25)' },
  cBadgeTxt: { fontSize: 10.5, fontWeight: '700', color: Colors.textSecondary },
  cBadgeTxtOn: { color: Colors.white },

  card: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 13, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  num: { fontSize: 15.5, fontWeight: '800', color: Colors.text, flex: 1 },
  lateChip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#fdf3e0', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  lateTxt: { color: '#b45309', fontSize: 10, fontWeight: '800' },
  ncrChip: { backgroundColor: '#fdecea', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  ncrTxt: { color: '#c62828', fontSize: 10, fontWeight: '800' },
  statusChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  statusTxt: { color: Colors.white, fontSize: 10.5, fontWeight: '700' },
  proj: { color: Colors.textSecondary, fontSize: 12.5, marginTop: 6 },
  progRow: { flexDirection: 'row', alignItems: 'center', marginTop: 9 },
  track: { flex: 1, height: 7, backgroundColor: Colors.light, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 4 },
  fillDone: { backgroundColor: Colors.success },
  pct: { marginLeft: 9, fontSize: 13, fontWeight: '800', color: Colors.text },
  meta: { color: Colors.textSecondary, fontSize: 11.5, marginTop: 6 },
});
