import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, RefreshControl,
  ActivityIndicator, Modal, Linking, TextInput, useWindowDimensions, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import {
  ordersService, qcReportsService, MOrderAudit, MAuditItem, MTemplate,
  OrderStatusColors, OrderStatusLabels,
} from '../../services/projects.service';
import { authService } from '../../services/auth.service';
import { environment } from '../../config/environment';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'OrderBoard'>;
type Rt = RouteProp<ProjectsStackParamList, 'OrderBoard'>;

const ALL = '__all__';
const DONE = '__done__';
const SS_COLOR: Record<string, string> = { pending: '#9ca3af', in_progress: '#f9a825', completed: '#2e7d32', skipped: '#9ca3af' };
const SS_LABEL: Record<string, string> = { pending: 'Not started', in_progress: 'In progress', completed: 'Done', skipped: 'Skipped' };
const TYPE_SEGS: { key: string; label: string }[] = [
  { key: 'assembly', label: 'Assemblies' },
  { key: 'subassembly', label: 'Sub assemblies' },
  { key: 'part', label: 'Parts' },
];

/**
 * Work-order AUDIT dashboard (FabStation style): the stage rail on the left
 * (or as chips on phones), assemblies at the selected stage on the right,
 * type segments + search, and long-press multi-select for BULK stage updates.
 * Tap an assembly to open its full stage audit.
 */
export function OrderBoardScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { orderId, projectId, orderNumber } = route.params;
  const { width } = useWindowDimensions();
  const wide = width >= 700;

  const [audit, setAudit] = useState<MOrderAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stageSel, setStageSel] = useState<string>(ALL);
  const [typeSel, setTypeSel] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Bulk select mode (long-press a card to start)
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // QC report templates → blank report → filled on the web (opened with the auth token).
  const [tplVisible, setTplVisible] = useState(false);
  const [templates, setTemplates] = useState<MTemplate[]>([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const a = await ordersService.audit(orderId);
      setAudit(a);
    } catch {
      setAudit(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const openTemplates = useCallback(async () => {
    setTplVisible(true);
    setTplError(null);
    if (templates.length === 0) {
      setTplLoading(true);
      try { setTemplates(await qcReportsService.templates()); }
      catch { setTplError('Could not load templates.'); }
      finally { setTplLoading(false); }
    }
  }, [templates.length]);

  const startReport = useCallback(async (t: MTemplate) => {
    if (tplBusy) return;
    setTplBusy(true);
    setTplError(null);
    try {
      const r = await qcReportsService.create({ templateId: t.id, productionOrderId: orderId });
      const token = (await authService.getToken()) ?? '';
      setTplVisible(false);
      await Linking.openURL(`${environment.webUrl}/qr/${r.id}?token=${encodeURIComponent(token)}`);
    } catch {
      setTplError('Could not start the report.');
    } finally {
      setTplBusy(false);
    }
  }, [tplBusy, orderId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: orderNumber || 'Work order',
      headerRight: () => (
        <TouchableOpacity onPress={openTemplates} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 14 }}>QC Report</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, orderNumber, openTemplates]);

  const items = audit?.items ?? [];
  const stages = audit?.stages ?? [];

  const isDone = useCallback((it: MAuditItem) => it.stages.length > 0 && it.stages.every((s) => s.status === 'completed' || s.status === 'skipped'), []);
  const atStage = useCallback((it: MAuditItem, stageId: string) => {
    if (isDone(it)) return false;
    const r = it.stages.find((s) => s.stageId === stageId);
    return !!r && (r.status === 'pending' || r.status === 'in_progress');
  }, [isDone]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { [ALL]: items.length, [DONE]: 0 };
    for (const it of items) {
      if (isDone(it)) { c[DONE]++; continue; }
      for (const s of stages) if (atStage(it, s.id)) c[s.id] = (c[s.id] ?? 0) + 1;
    }
    return c;
  }, [items, stages, isDone, atStage]);

  const typeSegs = useMemo(() => TYPE_SEGS.filter((t) => items.some((i) => i.nodeType === t.key)), [items]);

  const visible = useMemo(() => {
    let rows = items;
    if (stageSel === DONE) rows = rows.filter(isDone);
    else if (stageSel !== ALL) rows = rows.filter((it) => atStage(it, stageSel));
    if (typeSel) rows = rows.filter((it) => it.nodeType === typeSel);
    const term = query.trim().toLowerCase();
    if (term) rows = rows.filter((it) => it.mark.toLowerCase().includes(term) || (it.name ?? '').toLowerCase().includes(term) || it.workOrderNumber.toLowerCase().includes(term));
    return rows;
  }, [items, stageSel, typeSel, query, isDone, atStage]);

  // ── Bulk update ──
  const toggleSelect = (it: MAuditItem) => {
    if (!it.nodeId) return;
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(it.workOrderId)) next.delete(it.workOrderId);
      else next.add(it.workOrderId);
      return next;
    });
  };
  const startSelect = (it: MAuditItem) => {
    if (!selectMode) setSelectMode(true);
    toggleSelect(it);
  };
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const selectAllVisible = () => setSelected(new Set(visible.filter((i) => !!i.nodeId).map((i) => i.workOrderId)));

  const applyBulk = (status: 'completed' | 'pending' | 'skipped' | 'in_progress') => {
    if (stageSel === ALL || stageSel === DONE || selected.size === 0 || bulkBusy) return;
    const byWo = new Map(items.map((i) => [i.workOrderId, i]));
    const nodeIds = [...selected].map((k) => byWo.get(k)?.nodeId).filter((x): x is string => !!x);
    if (!nodeIds.length) return;
    const stageName = stages.find((s) => s.id === stageSel)?.name ?? 'stage';
    const verb = status === 'completed' ? 'Complete' : status === 'pending' ? 'Reset' : status === 'skipped' ? 'Skip' : 'Start';
    Alert.alert(`${verb} ${stageName}`, `${verb} "${stageName}" on ${nodeIds.length} assemblies?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: verb,
        style: status === 'skipped' ? 'destructive' : 'default',
        onPress: async () => {
          setBulkBusy(true);
          try {
            const res = await ordersService.bulkUpdate(orderId, { stageId: stageSel, nodeIds, status });
            await load();
            if (res.failed.length) {
              Alert.alert('Partially applied', `Updated ${res.updated}/${res.requested}.\n\n${res.failed.map((f) => `${f.mark}: ${f.message}`).join('\n')}`);
            } else {
              exitSelect();
            }
          } catch (e: any) {
            Alert.alert('Bulk update failed', e?.message || 'Try again.');
          } finally {
            setBulkBusy(false);
          }
        },
      },
    ]);
  };

  // ── Pieces ──
  const StageRail = (
    <View style={wide ? styles.rail : undefined}>
      {wide && <Text style={styles.railTitle}>Stages</Text>}
      <ScrollView
        horizontal={!wide}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={!wide ? styles.chipBar : styles.railList}
      >
        {[{ id: ALL, name: 'All assemblies' }, ...stages, { id: DONE, name: 'Done' }].map((s: any, idx, arr) => {
          const on = stageSel === s.id;
          const count = counts[s.id] ?? 0;
          const num = s.id === ALL ? null : s.id === DONE ? '✓' : String(idx);
          return (
            <View key={s.id} style={wide ? undefined : undefined}>
              <TouchableOpacity
                style={[wide ? styles.railItem : styles.chip, on && (wide ? styles.railItemOn : styles.chipOn)]}
                onPress={() => setStageSel(s.id)}
              >
                {num != null && (
                  <View style={[styles.seqDot, on && styles.seqDotOn]}>
                    <Text style={[styles.seqTxt, on && styles.seqTxtOn]}>{num}</Text>
                  </View>
                )}
                <Text style={[wide ? styles.railName : styles.chipName, on && (wide ? styles.railNameOn : styles.chipNameOn)]} numberOfLines={2}>
                  {s.name}
                </Text>
                <View style={[styles.cBadge, on && styles.cBadgeOn]}>
                  <Text style={[styles.cBadgeTxt, on && styles.cBadgeTxtOn]}>{count}</Text>
                </View>
              </TouchableOpacity>
              {wide && idx < arr.length - 1 && <View style={styles.railConn} />}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );

  const Header = (
    <View>
      {/* order summary */}
      {audit && (
        <View style={styles.summary}>
          <View style={styles.sumTop}>
            <Text style={styles.sumProject} numberOfLines={1}>
              {audit.project?.name ?? 'Project'}{audit.order.customerName ? `  ·  ${audit.order.customerName}` : ''}
            </Text>
            <View style={[styles.statusChip, { backgroundColor: OrderStatusColors[audit.order.status] || Colors.medium }]}>
              <Text style={styles.statusTxt}>{OrderStatusLabels[audit.order.status] || audit.order.status}</Text>
            </View>
          </View>
          <View style={styles.sumBarRow}>
            <View style={styles.sumTrack}><View style={[styles.sumFill, { width: `${Math.min(100, audit.totals.percent)}%` as any }]} /></View>
            <Text style={styles.sumPct}>{Math.round(audit.totals.percent)}%</Text>
          </View>
          <Text style={styles.sumMeta}>
            {audit.totals.itemsDone}/{audit.totals.items} assemblies done · {audit.totals.unitsDone}/{audit.totals.unitsTotal} units
            {audit.totals.openNcrs > 0 ? ` · ${audit.totals.openNcrs} open NCR` : ''}
          </Text>
        </View>
      )}

      {!wide && StageRail}

      {/* type segments + search */}
      {typeSegs.length > 1 && (
        <View style={styles.segWrap}>
          {typeSegs.map((t) => {
            const on = typeSel === t.key;
            return (
              <TouchableOpacity key={t.key} style={[styles.seg, on && styles.segOn]} onPress={() => setTypeSel(on ? null : t.key)}>
                <Text style={[styles.segTxt, on && styles.segTxtOn]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search assemblies…"
          placeholderTextColor={Colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {!!query && <TouchableOpacity onPress={() => setQuery('')}><Ionicons name="close-circle" size={16} color={Colors.textSecondary} /></TouchableOpacity>}
      </View>
      <View style={styles.listLabelRow}>
        <Text style={styles.listLabel}>{visible.length} {visible.length === 1 ? 'assembly' : 'assemblies'}</Text>
        {selectMode ? (
          <View style={styles.selActions}>
            <TouchableOpacity onPress={selectAllVisible}><Text style={styles.selLink}>Select all</Text></TouchableOpacity>
            <TouchableOpacity onPress={exitSelect}><Text style={styles.selLink}>Cancel</Text></TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.hint}>Long-press to multi-select</Text>
        )}
      </View>
    </View>
  );

  const cols = wide ? 3 : 2;

  const renderCard = ({ item }: { item: MAuditItem }) => {
    const row = stageSel !== ALL && stageSel !== DONE ? item.stages.find((s) => s.stageId === stageSel) : undefined;
    const checked = selected.has(item.workOrderId);
    return (
      <TouchableOpacity
        style={[styles.acard, checked && styles.acardSel]}
        onPress={() =>
          selectMode
            ? toggleSelect(item)
            : navigation.navigate('AssemblyDetail', { orderId, projectId, nodeId: item.nodeId ?? '', mark: item.mark })}
        onLongPress={() => startSelect(item)}
        delayLongPress={250}
      >
        <View style={styles.cardTop}>
          <Text style={styles.atag}>{item.nodeType === 'subassembly' ? 'SUB' : item.nodeType === 'part' ? 'PART' : 'ASM'}</Text>
          <Text style={styles.amark} numberOfLines={1}>{item.mark}</Text>
          {selectMode && (
            <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={20} color={checked ? Colors.primary : Colors.medium} />
          )}
          {!selectMode && item.openNcrs > 0 && (
            <View style={styles.ncrDot}><Text style={styles.ncrDotTxt}>{item.openNcrs}</Text></View>
          )}
        </View>
        {row ? (
          <View style={styles.arow}>
            <View style={[styles.dot, { backgroundColor: SS_COLOR[row.status] || Colors.medium }]} />
            <Text style={styles.astatus} numberOfLines={1}>{SS_LABEL[row.status] || row.status}</Text>
            <Text style={styles.acount}>{row.qtyDone}/{row.qtyTotal}</Text>
          </View>
        ) : (
          <View style={styles.arow}>
            <View style={[styles.dot, { backgroundColor: item.status === 'completed' ? '#2e7d32' : item.status === 'in_progress' ? '#f9a825' : '#9ca3af' }]} />
            <Text style={styles.astatus} numberOfLines={1}>
              {item.status === 'completed' ? 'Completed' : item.status === 'in_progress' ? 'In progress' : 'Not started'}
            </Text>
            <Text style={styles.acount}>{Math.round(item.percent)}%</Text>
          </View>
        )}
        <View style={styles.miniTrack}><View style={[styles.miniFill, item.percent >= 100 && styles.miniFillDone, { width: `${Math.min(100, item.percent)}%` as any }]} /></View>
      </TouchableOpacity>
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  if (!audit) return <View style={styles.center}><Text style={styles.muted}>Work order not found.</Text></View>;

  const grid = (
    <FlatList
      style={styles.gridList}
      contentContainerStyle={styles.list}
      key={`grid-${cols}`}
      data={visible}
      keyExtractor={(i) => i.workOrderId}
      numColumns={cols}
      columnWrapperStyle={styles.colWrap}
      ListHeaderComponent={Header}
      renderItem={renderCard}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.muted}>Nothing {stageSel === DONE ? 'done yet' : 'here'}.</Text></View>}
    />
  );

  return (
    <View style={styles.container}>
      <View style={styles.bodyRow}>
        {wide && StageRail}
        {grid}
      </View>

      {/* Bulk action bar */}
      {selectMode && (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkCount}>{selected.size} selected</Text>
          {stageSel === ALL || stageSel === DONE ? (
            <Text style={styles.bulkHint}>Pick a stage to apply changes</Text>
          ) : bulkBusy ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <View style={styles.bulkBtns}>
              <TouchableOpacity style={[styles.bulkBtn, styles.bulkDone]} onPress={() => applyBulk('completed')}><Text style={styles.bulkBtnTxt}>Complete</Text></TouchableOpacity>
              <TouchableOpacity style={styles.bulkBtn} onPress={() => applyBulk('in_progress')}><Text style={styles.bulkBtnTxt}>Start</Text></TouchableOpacity>
              <TouchableOpacity style={styles.bulkBtn} onPress={() => applyBulk('pending')}><Text style={styles.bulkBtnTxt}>Reset</Text></TouchableOpacity>
              <TouchableOpacity style={styles.bulkBtn} onPress={() => applyBulk('skipped')}><Text style={styles.bulkBtnTxt}>Skip</Text></TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* QC report template picker */}
      <Modal visible={tplVisible} transparent animationType="slide" onRequestClose={() => setTplVisible(false)}>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Start a QC report</Text>
              <TouchableOpacity onPress={() => setTplVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.sheetSub}>Pick a template — a blank report opens in your browser to fill against {orderNumber || 'this work order'}.</Text>
            {tplLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginVertical: 20 }} />
            ) : templates.length === 0 ? (
              <Text style={styles.muted}>No templates yet — create one in the web portal (Quality → Report Templates).</Text>
            ) : (
              <ScrollView style={styles.sheetList}>
                {templates.map((t) => (
                  <TouchableOpacity key={t.id} style={styles.tplRow} disabled={tplBusy} onPress={() => startReport(t)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tplName}>{t.name}</Text>
                      <Text style={styles.tplType}>{t.type}</Text>
                    </View>
                    <Text style={styles.tplGo}>{tplBusy ? '…' : '›'}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            {tplError ? <Text style={styles.sheetErr}>{tplError}</Text> : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  bodyRow: { flex: 1, flexDirection: 'row' },
  gridList: { flex: 1 },
  list: { padding: 12, paddingBottom: 90 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { padding: 24, alignItems: 'center' },
  muted: { color: Colors.textSecondary, marginVertical: 6, textAlign: 'center' },

  /* order summary */
  summary: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 12 },
  sumTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sumProject: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  statusChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  statusTxt: { color: Colors.white, fontSize: 11, fontWeight: '700' },
  sumBarRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  sumTrack: { flex: 1, height: 9, backgroundColor: Colors.border, borderRadius: 5, overflow: 'hidden' },
  sumFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 5 },
  sumPct: { marginLeft: 10, fontSize: 14, fontWeight: '800', color: Colors.text },
  sumMeta: { marginTop: 6, fontSize: 12, color: Colors.textSecondary },

  /* stage rail (wide) */
  rail: { width: 240, borderRightWidth: 1, borderRightColor: Colors.border, backgroundColor: Colors.card },
  railTitle: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6 },
  railList: { paddingHorizontal: 10, paddingBottom: 16 },
  railItem: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: Colors.light, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 11 },
  railItemOn: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  railName: { flex: 1, fontSize: 13, fontWeight: '700', color: Colors.text, textTransform: 'uppercase', letterSpacing: 0.2 },
  railNameOn: { color: Colors.white },
  railConn: { width: 2, height: 12, backgroundColor: Colors.border, alignSelf: 'center' },

  /* stage chips (narrow) */
  chipBar: { paddingVertical: 4, paddingRight: 8, gap: 8, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: Colors.light, borderRadius: 18, paddingVertical: 7, paddingHorizontal: 11, borderWidth: 1, borderColor: Colors.border },
  chipOn: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  chipName: { color: Colors.text, fontSize: 13, fontWeight: '600', maxWidth: 150 },
  chipNameOn: { color: Colors.white },

  seqDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: Colors.medium, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card },
  seqDotOn: { borderColor: Colors.white, backgroundColor: 'transparent' },
  seqTxt: { fontSize: 11, fontWeight: '800', color: Colors.textSecondary },
  seqTxtOn: { color: Colors.white },
  cBadge: { backgroundColor: Colors.card, borderRadius: 10, minWidth: 22, paddingHorizontal: 6, paddingVertical: 1, alignItems: 'center' },
  cBadgeOn: { backgroundColor: 'rgba(255,255,255,0.25)' },
  cBadgeTxt: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary },
  cBadgeTxtOn: { color: Colors.white },

  /* type segments */
  segWrap: { flexDirection: 'row', backgroundColor: Colors.light, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 3, marginTop: 12 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segOn: { backgroundColor: '#cfe0f1' },
  segTxt: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  segTxtOn: { color: Colors.text, fontWeight: '800' },

  /* search */
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },
  listLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 4 },
  listLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  hint: { color: Colors.medium, fontSize: 11 },
  selActions: { flexDirection: 'row', gap: 16 },
  selLink: { color: Colors.primary, fontSize: 12, fontWeight: '700' },

  /* assembly cards */
  colWrap: { gap: 10 },
  acard: { flex: 1, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 10 },
  acardSel: { borderColor: Colors.primary, backgroundColor: '#e8f0fe' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  atag: { fontSize: 9, fontWeight: '800', color: Colors.primary, backgroundColor: Colors.light, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden' },
  amark: { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1 },
  ncrDot: { backgroundColor: '#fdecea', borderRadius: 999, minWidth: 20, paddingHorizontal: 5, paddingVertical: 1, alignItems: 'center' },
  ncrDotTxt: { color: '#c62828', fontSize: 10, fontWeight: '800' },
  arow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  astatus: { flex: 1, fontSize: 12, color: Colors.textSecondary },
  acount: { fontSize: 12, fontWeight: '700', color: Colors.text },
  miniTrack: { height: 4, backgroundColor: Colors.light, borderRadius: 3, overflow: 'hidden', marginTop: 8 },
  miniFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 3 },
  miniFillDone: { backgroundColor: Colors.success },

  /* bulk bar */
  bulkBar: { position: 'absolute', left: 12, right: 12, bottom: 14, backgroundColor: Colors.secondary, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  bulkCount: { color: Colors.white, fontWeight: '800', fontSize: 13 },
  bulkHint: { color: 'rgba(255,255,255,0.8)', fontSize: 12, flex: 1, textAlign: 'right' },
  bulkBtns: { flexDirection: 'row', gap: 6, flex: 1, justifyContent: 'flex-end' },
  bulkBtn: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  bulkDone: { backgroundColor: Colors.success, borderColor: Colors.success },
  bulkBtnTxt: { color: Colors.white, fontWeight: '700', fontSize: 12 },

  /* QC sheet */
  sheetWrap: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 18, maxHeight: '70%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  sheetClose: { fontSize: 16, color: Colors.textSecondary, fontWeight: '700' },
  sheetSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 4, marginBottom: 12 },
  sheetList: { marginTop: 2 },
  tplRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tplName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  tplType: { fontSize: 11, color: Colors.textSecondary, textTransform: 'capitalize', marginTop: 1 },
  tplGo: { fontSize: 20, color: Colors.primary, fontWeight: '700', paddingHorizontal: 6 },
  sheetErr: { color: '#c62828', fontSize: 12, marginTop: 10 },
});
