import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { ordersService, MOrder, MProcess, OrderStatusColors, OrderStatusLabels } from '../../services/projects.service';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectDetail'>;
type Rt = RouteProp<ProjectsStackParamList, 'ProjectDetail'>;

/** A project's WORK ORDERS — the trackable production instances (per customer/run). */
export function ProjectDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { projectId, name } = route.params;

  const [orders, setOrders] = useState<MOrder[]>([]);
  const [processes, setProcesses] = useState<MProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [customer, setCustomer] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [processId, setProcessId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: name || 'Project',
      headerRight: () => (
        <View style={styles.headActions}>
          <TouchableOpacity
            style={styles.headBtn}
            onPress={() => navigation.navigate('ProjectMonitoring', { projectId, name })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="pulse-outline" size={20} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headBtn}
            onPress={() => navigation.navigate('ProjectViewer', { projectId, name })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="cube-outline" size={18} color={Colors.primary} />
            <Text style={styles.headBtnTxt}>3D</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, name, projectId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, p] = await Promise.all([
        ordersService.listByProject(projectId),
        ordersService.processes().catch(() => [] as MProcess[]),
      ]);
      setOrders(o || []);
      setProcesses(p || []);
    } catch (e: any) {
      setOrders([]);
      setError(e?.message || 'Could not load work orders.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const submit = async () => {
    if (!processId) { setError('Pick a process for this work order.'); return; }
    setCreating(true); setError(null);
    try {
      const order = await ordersService.create(projectId, {
        processId,
        customerName: customer.trim() || undefined,
        quantity: Math.max(1, parseInt(quantity, 10) || 1),
      });
      setFormOpen(false); setCustomer(''); setQuantity('1'); setProcessId(null);
      await load();
      navigation.navigate('OrderBoard', { orderId: order.id, projectId, orderNumber: order.number });
    } catch (e: any) {
      setError(e?.message || 'Could not create work order.');
    } finally {
      setCreating(false);
    }
  };

  const Header = (
    <View>
      <View style={styles.headRow}>
        <Text style={styles.sectionTitle}>Work orders</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => setFormOpen((o) => !o)}>
          <Text style={styles.newBtnTxt}>{formOpen ? 'Cancel' : '+ New'}</Text>
        </TouchableOpacity>
      </View>
      {formOpen && (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="Customer (optional)" placeholderTextColor={Colors.textSecondary} value={customer} onChangeText={setCustomer} />
          <View style={styles.row}>
            <Text style={styles.lbl}>Quantity</Text>
            <TextInput style={[styles.input, styles.qtyInput]} keyboardType="numeric" value={quantity} onChangeText={setQuantity} />
          </View>
          <Text style={styles.lbl}>Process</Text>
          {processes.length === 0 ? (
            <Text style={styles.muted}>No processes found. Create one on the web first.</Text>
          ) : (
            <View style={styles.chips}>
              {processes.map((p) => (
                <TouchableOpacity key={p.id} style={[styles.chip, processId === p.id && styles.chipOn]} onPress={() => setProcessId(p.id)}>
                  <Text style={[styles.chipTxt, processId === p.id && styles.chipTxtOn]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TouchableOpacity style={[styles.createBtn, (creating || !processId) && styles.disabled]} disabled={creating || !processId} onPress={submit}>
            {creating ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.createTxt}>Create &amp; release</Text>}
          </TouchableOpacity>
        </View>
      )}
      {!!error && <Text style={styles.err}>{error}</Text>}
    </View>
  );

  const renderCard = ({ item }: { item: MOrder }) => {
    const color = OrderStatusColors[item.status] || Colors.medium;
    return (
      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('OrderBoard', { orderId: item.id, projectId, orderNumber: item.number })}>
        <View style={styles.cardTop}>
          <Text style={styles.num}>{item.number}</Text>
          <View style={[styles.statusChip, { backgroundColor: color }]}><Text style={styles.statusTxt}>{OrderStatusLabels[item.status] || item.status}</Text></View>
        </View>
        <Text style={styles.meta} numberOfLines={1}>{item.customerName ? item.customerName + '  ·  ' : ''}Qty {item.quantity}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <FlatList
          style={styles.container}
          contentContainerStyle={styles.list}
          data={orders}
          keyExtractor={(i) => i.id}
          ListHeaderComponent={Header}
          renderItem={renderCard}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.muted}>No work orders yet. Create one to track production for a customer or run.</Text></View>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  headBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headBtnTxt: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
  segWrap: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 6, backgroundColor: Colors.background },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  segOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  segTxt: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  segTxtOn: { color: Colors.white },
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { padding: 24, alignItems: 'center' },
  muted: { color: Colors.textSecondary, marginVertical: 6, textAlign: 'center' },
  err: { color: Colors.danger, marginVertical: 8, fontSize: 13 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  newBtn: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  newBtnTxt: { color: Colors.white, fontWeight: '700', fontSize: 13 },
  form: { backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 12, gap: 8 },
  input: { backgroundColor: Colors.white, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: Colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lbl: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  qtyInput: { width: 90 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: Colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Colors.white },
  chipOn: { borderColor: Colors.primary, backgroundColor: '#e8f0fe' },
  chipTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: 13 },
  chipTxtOn: { color: Colors.primary },
  createBtn: { backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  disabled: { opacity: 0.5 },
  createTxt: { color: Colors.white, fontWeight: '700', fontSize: 15 },
  card: { backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  num: { fontSize: 16, fontWeight: '700', color: Colors.text },
  statusChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  statusTxt: { color: Colors.white, fontSize: 11, fontWeight: '700' },
  meta: { color: Colors.textSecondary, fontSize: 13, marginTop: 6 },
});
