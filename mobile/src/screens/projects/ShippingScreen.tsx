import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { WO, SHIP_META } from '../../theme/wo';
import { ProjectsStackParamList } from '../../navigation/types';
import { can } from '../../config/permissions';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import {
  shippingService, MShipment, MShipmentItem, MShipReadyRow, MShipmentStatus,
  MShipStatusLabels, MDeliveryNote,
} from '../../services/projects.service';

type Rt = RouteProp<ProjectsStackParamList, 'Shipping'>;

const STATUS_FLOW: MShipmentStatus[] = ['planned', 'loaded', 'shipped', 'delivered', 'cancelled'];
const STATUS_CHIP: Record<MShipmentStatus, { fg: string; bg: string }> = {
  planned: { fg: WO.textSoft, bg: WO.muteBg },
  loaded: { fg: WO.info, bg: WO.infoBg },
  shipped: { fg: WO.good, bg: WO.goodBg },
  delivered: { fg: WO.good, bg: WO.goodBg },
  cancelled: { fg: WO.bad, bg: WO.badBg },
};

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function kg(n?: number | null): string {
  return n == null ? '—' : `${Math.round(n).toLocaleString()} kg`;
}
const isOpenLoad = (s: MShipment) => s.status !== 'shipped' && s.status !== 'delivered' && s.status !== 'cancelled';

export function ShippingScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<Rt>();
  const { orderId, projectId, orderNumber } = route.params;

  const canManage = can('shipping.manage');
  const canDelete = can('shipping.delete');

  const [shipments, setShipments] = useState<MShipment[]>([]);
  const [ready, setReady] = useState<MShipReadyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create-load modal
  const [createVisible, setCreateVisible] = useState(false);
  const [createForm, setCreateForm] = useState({ number: '', destination: '', carrier: '' });
  const [creating, setCreating] = useState(false);

  // Delivery-note (packing slip) modal
  const [dnVisible, setDnVisible] = useState(false);
  const [dn, setDn] = useState<MDeliveryNote | null>(null);
  const [dnLoading, setDnLoading] = useState(false);

  const load = useCallback(async () => {
    const [shipRes, boardRes] = await Promise.allSettled([
      shippingService.listByOrder(orderId),
      shippingService.board(orderId),
    ]);
    if (shipRes.status === 'fulfilled') {
      const list = shipRes.value ?? [];
      setShipments(list);
      // Keep a sensible target load selected: the chosen one if still open,
      // else the newest still-open load (so "Add" works straight after create).
      setSelectedId((prev) => {
        if (prev && list.some((s) => s.id === prev && isOpenLoad(s))) return prev;
        const open = list.find(isOpenLoad);
        return open?.id ?? null;
      });
    }
    if (boardRes.status === 'fulfilled') setReady(boardRes.value ?? []);
    setLoading(false);
  }, [orderId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Completing stages elsewhere changes readiness — refresh on the same events
  // the board uses (debounced).
  const rt = useRef<ReturnType<typeof setTimeout> | null>(null);
  useSocketEvent('work-order-update', () => {
    if (rt.current) clearTimeout(rt.current);
    rt.current = setTimeout(() => load(), 600);
  });
  useEffect(() => () => { if (rt.current) clearTimeout(rt.current); }, []);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const selected = useMemo(() => shipments.find((s) => s.id === selectedId) || null, [shipments, selectedId]);
  const totals = useMemo(() => ({
    readyUnits: ready.filter((r) => !r.blocked).reduce((a, r) => a + r.availableQty, 0),
    shippedUnits: ready.reduce((a, r) => a + r.shippedQty, 0),
    blocked: ready.filter((r) => r.blocked).length,
  }), [ready]);

  // ── Mutations ──
  const openCreate = () => {
    setCreateForm({ number: `LOAD-${shipments.length + 1}`, destination: '', carrier: '' });
    setError(null);
    setCreateVisible(true);
  };
  const submitCreate = async () => {
    const number = createForm.number.trim();
    if (!number) { Alert.alert('Load number required', 'Give the load a name/number.'); return; }
    setCreating(true);
    try {
      const created = await shippingService.create({
        productionOrderId: orderId,
        shipmentNumber: number,
        destination: createForm.destination.trim() || undefined,
        carrier: createForm.carrier.trim() || undefined,
      });
      setCreateVisible(false);
      await load();
      setSelectedId(created.id);
    } catch (e: any) {
      Alert.alert('Could not create load', e?.message || 'Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const addToLoad = async (row: MShipReadyRow) => {
    if (!canManage) return;
    if (!selectedId) { Alert.alert('Pick a load', 'Select or create a load first, then add pieces to it.'); return; }
    if (row.blocked || row.availableQty <= 0) return;
    setBusy(true); setError(null);
    try {
      await shippingService.addItem(selectedId, row.nodeId, row.availableQty);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not add the assembly to this load.');
    } finally {
      setBusy(false);
    }
  };

  const removeItem = (shipment: MShipment, item: MShipmentItem) => {
    Alert.alert('Remove from load', `Remove ${item.assemblyNode?.mark || 'this assembly'} from ${shipment.shipmentNumber}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try { await shippingService.removeItem(shipment.id, item.id); await load(); }
          catch (e: any) { setError(e?.message || 'Could not remove item.'); }
        },
      },
    ]);
  };

  const changeStatus = (s: MShipment) => {
    if (!canManage) return;
    const opts = STATUS_FLOW.filter((st) => st !== s.status).map((st) => ({
      text: MShipStatusLabels[st],
      style: (st === 'cancelled' ? 'destructive' : 'default') as 'destructive' | 'default',
      onPress: async () => {
        try { await shippingService.setStatus(s.id, st); await load(); }
        catch (e: any) { setError(e?.message || 'Could not update status.'); }
      },
    }));
    Alert.alert(
      `${s.shipmentNumber} — set status`,
      'Marking a load Shipped advances its assemblies as shipped.',
      [...opts, { text: 'Cancel', style: 'cancel' }],
    );
  };

  const deleteLoad = (s: MShipment) => {
    Alert.alert('Delete load', `Delete ${s.shipmentNumber}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await shippingService.remove(s.id);
            if (selectedId === s.id) setSelectedId(null);
            await load();
          } catch (e: any) { setError(e?.message || 'Could not delete load.'); }
        },
      },
    ]);
  };

  const openDeliveryNote = async (s: MShipment) => {
    setDnVisible(true); setDn(null); setDnLoading(true);
    try { setDn(await shippingService.deliveryNote(s.id)); }
    catch { setDn(null); }
    finally { setDnLoading(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      {/* Summary band */}
      <View style={styles.band}>
        <Text style={styles.bandTitle}>{orderNumber}</Text>
        <View style={styles.bandStats}>
          <View style={styles.bandStat}><Text style={styles.bandNum}>{totals.readyUnits}</Text><Text style={styles.bandLbl}>To ship</Text></View>
          <View style={styles.bandDiv} />
          <View style={styles.bandStat}><Text style={styles.bandNum}>{totals.shippedUnits}</Text><Text style={styles.bandLbl}>Shipped</Text></View>
          <View style={styles.bandDiv} />
          <View style={styles.bandStat}><Text style={[styles.bandNum, totals.blocked > 0 && { color: '#ff9d94' }]}>{totals.blocked}</Text><Text style={styles.bandLbl}>Blocked</Text></View>
        </View>
      </View>

      {!!error && (
        <View style={styles.errBar}>
          <Ionicons name="alert-circle" size={15} color={Colors.white} />
          <Text style={styles.errTxt}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}><Text style={styles.errClose}>×</Text></TouchableOpacity>
        </View>
      )}

      {/* ── Loads ── */}
      <View style={styles.secHead}>
        <Text style={styles.secTitle}>Loads</Text>
        {canManage && (
          <TouchableOpacity style={styles.newBtn} onPress={openCreate}>
            <Ionicons name="add" size={16} color={Colors.white} />
            <Text style={styles.newBtnTxt}>New load</Text>
          </TouchableOpacity>
        )}
      </View>

      {shipments.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="cube-outline" size={30} color={WO.textSoft} />
          <Text style={styles.emptyTxt}>No loads yet.{canManage ? ' Create one, then add ready pieces to it.' : ''}</Text>
        </View>
      ) : (
        shipments.map((s) => {
          const sel = s.id === selectedId;
          const chip = STATUS_CHIP[s.status];
          return (
            <TouchableOpacity
              key={s.id}
              activeOpacity={canManage ? 0.7 : 1}
              onPress={() => canManage && isOpenLoad(s) && setSelectedId(s.id)}
              style={[styles.loadCard, sel && styles.loadCardSel]}
            >
              <View style={styles.loadTop}>
                {sel && <Ionicons name="checkmark-circle" size={16} color={Colors.primary} style={{ marginRight: 4 }} />}
                <Text style={styles.loadNum}>{s.shipmentNumber}</Text>
                <TouchableOpacity
                  disabled={!canManage}
                  onPress={() => changeStatus(s)}
                  style={[styles.statusChip, { backgroundColor: chip.bg }]}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={[styles.statusTxt, { color: chip.fg }]}>{MShipStatusLabels[s.status]}</Text>
                  {canManage && <Ionicons name="chevron-down" size={11} color={chip.fg} style={{ marginLeft: 2 }} />}
                </TouchableOpacity>
              </View>

              {(s.destination || s.carrier || s.plannedDate) && (
                <Text style={styles.loadMeta} numberOfLines={1}>
                  {[s.destination, s.carrier, fmtDate(s.plannedDate)].filter(Boolean).join('  ·  ')}
                </Text>
              )}

              {/* Items */}
              {s.items.length === 0 ? (
                <Text style={styles.loadEmpty}>No pieces yet{sel ? ' — add from “Ready to ship” below' : ''}.</Text>
              ) : (
                <View style={styles.itemWrap}>
                  {s.items.map((it) => (
                    <View key={it.id} style={styles.itemChip}>
                      <Text style={styles.itemTxt}>{it.assemblyNode?.mark || it.assemblyNode?.name || 'Assembly'} ×{it.quantity}</Text>
                      {canManage && (
                        <TouchableOpacity onPress={() => removeItem(s, it)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                          <Ionicons name="close" size={13} color={WO.textSoft} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* Card actions */}
              <View style={styles.loadActions}>
                <TouchableOpacity style={styles.linkBtn} onPress={() => openDeliveryNote(s)} disabled={s.items.length === 0}>
                  <Ionicons name="document-text-outline" size={15} color={s.items.length ? Colors.primary : WO.textSoft} />
                  <Text style={[styles.linkTxt, !s.items.length && { color: WO.textSoft }]}>Delivery note</Text>
                </TouchableOpacity>
                {canDelete && (
                  <TouchableOpacity style={styles.linkBtn} onPress={() => deleteLoad(s)}>
                    <Ionicons name="trash-outline" size={15} color={WO.bad} />
                    <Text style={[styles.linkTxt, { color: WO.bad }]}>Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        })
      )}

      {/* ── Ready to ship ── */}
      <View style={styles.secHead}>
        <Text style={styles.secTitle}>Ready to ship</Text>
        <Text style={styles.secCount}>{ready.filter((r) => r.availableQty > 0 && !r.blocked).length}</Text>
      </View>

      {canManage && (
        <Text style={styles.addingHint}>
          {selected ? `Adding to ${selected.shipmentNumber}` : 'Select a load above to add pieces'}
        </Text>
      )}

      {ready.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="checkmark-done-circle-outline" size={30} color={WO.textSoft} />
          <Text style={styles.emptyTxt}>Nothing ready yet. Complete an assembly’s stages on the board to see it here.</Text>
        </View>
      ) : (
        ready.map((r) => {
          const meta = r.blocked
            ? SHIP_META.blocked_ncr
            : r.availableQty > 0
              ? SHIP_META.ready
              : r.shippedQty > 0
                ? SHIP_META.shipped
                : SHIP_META.allocated;
          const canAdd = canManage && !r.blocked && r.availableQty > 0;
          return (
            <View key={r.nodeId} style={styles.readyRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.readyMark} numberOfLines={1}>{r.mark || r.name || 'Assembly'}</Text>
                <Text style={styles.readySub} numberOfLines={1}>
                  {[r.profile, kg(r.weightKg)].filter(Boolean).join('  ·  ')}
                  {r.availableQty > 0 ? `  ·  ${r.availableQty} available` : ''}
                </Text>
              </View>
              {r.blocked ? (
                <View style={[styles.pill, { backgroundColor: meta.bg }]}>
                  <Ionicons name="alert-circle" size={12} color={meta.fg} />
                  <Text style={[styles.pillTxt, { color: meta.fg }]}>{r.openNcr} NCR</Text>
                </View>
              ) : canAdd ? (
                <TouchableOpacity style={[styles.addBtn, (!selectedId || busy) && styles.addBtnOff]} onPress={() => addToLoad(r)} disabled={!selectedId || busy}>
                  <Ionicons name="add" size={15} color={Colors.white} />
                  <Text style={styles.addBtnTxt}>Add {r.availableQty}</Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.pill, { backgroundColor: meta.bg }]}>
                  <Ionicons name={meta.icon as any} size={12} color={meta.fg} />
                  <Text style={[styles.pillTxt, { color: meta.fg }]}>{meta.short}</Text>
                </View>
              )}
            </View>
          );
        })
      )}

      <View style={{ height: 24 }} />

      {/* ── Create-load modal ── */}
      <Modal visible={createVisible} transparent animationType="slide" onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>New load</Text>
              <TouchableOpacity onPress={() => setCreateVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={WO.textSoft} />
              </TouchableOpacity>
            </View>
            <Field label="Load number" value={createForm.number} onChangeText={(t) => setCreateForm((s) => ({ ...s, number: t }))} autoCapitalize="characters" />
            <Field label="Destination (optional)" value={createForm.destination} onChangeText={(t) => setCreateForm((s) => ({ ...s, destination: t }))} />
            <Field label="Carrier (optional)" value={createForm.carrier} onChangeText={(t) => setCreateForm((s) => ({ ...s, carrier: t }))} />
            <TouchableOpacity style={[styles.modalSave, creating && { opacity: 0.6 }]} onPress={submitCreate} disabled={creating}>
              {creating ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.modalSaveTxt}>Create load</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Delivery note (packing slip) modal ── */}
      <Modal visible={dnVisible} transparent animationType="slide" onRequestClose={() => setDnVisible(false)}>
        <View style={styles.dnWrap}>
          <View style={styles.dnSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Delivery note</Text>
              <TouchableOpacity onPress={() => setDnVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={WO.textSoft} />
              </TouchableOpacity>
            </View>
            {dnLoading ? (
              <View style={{ paddingVertical: 30 }}><ActivityIndicator color={Colors.primary} /></View>
            ) : !dn ? (
              <Text style={styles.loadEmpty}>Could not load the delivery note.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 480 }}>
                <Text style={styles.dnOrg}>{dn.organization?.name}</Text>
                <Text style={styles.dnSub}>{dn.project?.name}{dn.order?.number ? `  ·  ${dn.order.number}` : ''}</Text>
                <Text style={styles.dnSub}>{dn.shipment.number} · {dn.shipment.status}{dn.shipment.destination ? `  ·  ${dn.shipment.destination}` : ''}</Text>
                <View style={styles.dnHeadRow}>
                  <Text style={[styles.dnH, { flex: 2 }]}>Mark</Text>
                  <Text style={[styles.dnH, { flex: 2 }]}>Profile</Text>
                  <Text style={[styles.dnH, styles.dnR]}>Qty</Text>
                  <Text style={[styles.dnH, styles.dnR, { flex: 1.4 }]}>Weight</Text>
                </View>
                {dn.items.map((it, i) => (
                  <View key={i} style={styles.dnRow}>
                    <Text style={[styles.dnCell, { flex: 2, fontWeight: '700', color: WO.text }]} numberOfLines={1}>{it.mark || it.name || '—'}</Text>
                    <Text style={[styles.dnCell, { flex: 2 }]} numberOfLines={1}>{it.profile || '—'}</Text>
                    <Text style={[styles.dnCell, styles.dnR]}>{it.quantity}</Text>
                    <Text style={[styles.dnCell, styles.dnR, { flex: 1.4 }]}>{it.lineWeightKg != null ? `${Math.round(it.lineWeightKg)}` : '—'}</Text>
                  </View>
                ))}
                <View style={styles.dnTotals}>
                  <Text style={styles.dnTotTxt}>{dn.totals.lines} lines · {dn.totals.pieces} pieces</Text>
                  <Text style={styles.dnTotTxt}>{kg(dn.totals.weightKg)}</Text>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Field({ label, ...input }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.fieldLbl}>{label}</Text>
      <TextInput style={styles.fieldInput} placeholderTextColor={WO.textSoft} {...input} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WO.mist },
  content: { padding: 12, paddingBottom: 28 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: WO.mist },

  band: { backgroundColor: WO.ink, borderRadius: 14, padding: 16, marginBottom: 12 },
  bandTitle: { color: WO.onInk, fontSize: 16, fontWeight: '800', marginBottom: 12 },
  bandStats: { flexDirection: 'row', alignItems: 'center' },
  bandStat: { flex: 1, alignItems: 'center' },
  bandDiv: { width: 1, height: 28, backgroundColor: WO.inkLine },
  bandNum: { color: WO.onInk, fontSize: 20, fontWeight: '800' },
  bandLbl: { color: WO.onInkFaint, fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },

  errBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(198,40,40,0.95)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  errTxt: { flex: 1, color: Colors.white, fontSize: 13, fontWeight: '600' },
  errClose: { color: Colors.white, fontSize: 18, fontWeight: '800', paddingHorizontal: 4 },

  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 10 },
  secTitle: { fontSize: 17, fontWeight: '800', color: WO.text },
  secCount: { fontSize: 13, fontWeight: '800', color: WO.textSoft, backgroundColor: WO.muteBg, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  newBtnTxt: { color: Colors.white, fontWeight: '700', fontSize: 13 },

  emptyCard: { alignItems: 'center', gap: 8, backgroundColor: WO.card, borderRadius: 12, borderWidth: 1, borderColor: WO.line, paddingVertical: 26, paddingHorizontal: 18, marginBottom: 14 },
  emptyTxt: { color: WO.textSoft, fontSize: 13, textAlign: 'center' },

  loadCard: { backgroundColor: WO.card, borderRadius: 12, borderWidth: 1, borderColor: WO.line, padding: 13, marginBottom: 10 },
  loadCardSel: { borderColor: Colors.primary, borderWidth: 2, padding: 12 },
  loadTop: { flexDirection: 'row', alignItems: 'center' },
  loadNum: { flex: 1, fontSize: 15.5, fontWeight: '800', color: WO.text },
  statusChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusTxt: { fontSize: 11, fontWeight: '800' },
  loadMeta: { color: WO.textSoft, fontSize: 12, marginTop: 6 },
  loadEmpty: { color: WO.textSoft, fontSize: 12.5, marginTop: 8, fontStyle: 'italic' },
  itemWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  itemChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: WO.muteBg, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  itemTxt: { fontSize: 12.5, fontWeight: '600', color: WO.text },
  loadActions: { flexDirection: 'row', gap: 18, marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: WO.line, paddingTop: 10 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  linkTxt: { color: Colors.primary, fontSize: 13, fontWeight: '700' },

  addingHint: { fontSize: 12.5, color: WO.textSoft, marginBottom: 10, marginTop: -2 },

  readyRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: WO.card, borderRadius: 12, borderWidth: 1, borderColor: WO.line, padding: 13, marginBottom: 8 },
  readyMark: { fontSize: 14.5, fontWeight: '800', color: WO.text },
  readySub: { fontSize: 12, color: WO.textSoft, marginTop: 3 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  pillTxt: { fontSize: 11, fontWeight: '800' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 8 },
  addBtnOff: { opacity: 0.4 },
  addBtnTxt: { color: Colors.white, fontWeight: '800', fontSize: 13 },

  // Modals
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 32 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: WO.text },
  fieldLbl: { fontSize: 12.5, fontWeight: '600', color: WO.textSoft, marginBottom: 6 },
  fieldInput: { borderWidth: 1, borderColor: WO.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: WO.text },
  modalSave: { height: 50, backgroundColor: Colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  modalSaveTxt: { color: Colors.white, fontSize: 16, fontWeight: '700' },

  dnWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  dnSheet: { backgroundColor: Colors.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 28 },
  dnOrg: { fontSize: 16, fontWeight: '800', color: WO.text },
  dnSub: { fontSize: 12.5, color: WO.textSoft, marginTop: 2 },
  dnHeadRow: { flexDirection: 'row', marginTop: 14, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: WO.line },
  dnH: { flex: 1, fontSize: 11, fontWeight: '800', color: WO.textSoft, textTransform: 'uppercase', letterSpacing: 0.3 },
  dnRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: WO.line },
  dnCell: { flex: 1, fontSize: 12.5, color: WO.textSoft },
  dnR: { flex: 1, textAlign: 'right' },
  dnTotals: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  dnTotTxt: { fontSize: 13, fontWeight: '800', color: WO.text },
});
