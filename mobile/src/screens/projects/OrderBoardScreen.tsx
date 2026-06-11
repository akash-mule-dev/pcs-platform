import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, Modal, Linking } from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { ordersService, qcReportsService, MOrderBoard, MOrderBoardItem, MOrderStageRow, MTemplate } from '../../services/projects.service';
import { authService } from '../../services/auth.service';
import { environment } from '../../config/environment';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'OrderBoard'>;
type Rt = RouteProp<ProjectsStackParamList, 'OrderBoard'>;
const DONE = '__done__';
const SS_LABEL: Record<string, string> = { pending: 'Queued', in_progress: 'In progress', completed: 'Done', skipped: 'Skipped' };
const SS_COLOR: Record<string, string> = { pending: '#9ca3af', in_progress: '#f9a825', completed: '#2e7d32', skipped: '#9ca3af' };

/** Per-order stage board: pick a stage → see the assemblies with work there (count-based). */
export function OrderBoardScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { orderId, projectId, orderNumber } = route.params;

  const [board, setBoard] = useState<MOrderBoard | null>(null);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // QC report templates → blank report → filled on the web (opened with the auth token).
  const [tplVisible, setTplVisible] = useState(false);
  const [templates, setTemplates] = useState<MTemplate[]>([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);

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
      // Hand off to the web fill page with the auth token (stored + stripped there).
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

  const load = useCallback(async () => {
    try {
      const b = await ordersService.board(orderId);
      setBoard(b);
      setSelectedStage((cur) => cur ?? (b.stages.length ? b.stages[0].id : null));
    } catch {
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const stages = board?.stages ?? [];
  const items = board?.items ?? [];

  const rowAt = (item: MOrderBoardItem, stageId: string): MOrderStageRow | undefined => item.stages.find((s) => s.stageId === stageId);
  const isDone = useCallback((item: MOrderBoardItem): boolean => item.stages.length > 0 && item.stages.every((s) => s.status === 'completed' || s.status === 'skipped'), []);
  const inStage = useCallback((item: MOrderBoardItem, stageId: string): boolean => {
    if (isDone(item)) return false;
    const r = rowAt(item, stageId);
    return !!r && (r.status === 'pending' || r.status === 'in_progress');
  }, [isDone]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) {
      if (isDone(it)) { c[DONE] = (c[DONE] ?? 0) + 1; continue; }
      for (const s of stages) if (inStage(it, s.id)) c[s.id] = (c[s.id] ?? 0) + 1;
    }
    return c;
  }, [items, stages, isDone, inStage]);

  const chips = useMemo(() => {
    const arr = stages.map((s, i) => ({ id: s.id, label: s.name, num: i + 1, count: counts[s.id] ?? 0 }));
    if ((counts[DONE] ?? 0) > 0) arr.push({ id: DONE, label: 'Done', num: arr.length + 1, count: counts[DONE] });
    return arr;
  }, [stages, counts]);

  const visible = useMemo(
    () => items.filter((it) => (selectedStage === DONE ? isDone(it) : selectedStage ? inStage(it, selectedStage) : false)),
    [items, selectedStage, isDone, inStage],
  );

  const Header = (
    <View>
      <Text style={styles.sectionTitle}>Stage — tap to filter</Text>
      {stages.length === 0 ? (
        <Text style={styles.muted}>This work order has no stages.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stageBar}>
          {chips.map((c) => {
            const on = selectedStage === c.id;
            return (
              <TouchableOpacity key={c.id} style={[styles.stageChip, on && styles.stageChipOn]} onPress={() => setSelectedStage(c.id)}>
                <Text style={[styles.stageChipName, on && styles.stageChipNameOn]} numberOfLines={1}>{c.id === DONE ? '✓ ' : `${c.num}. `}{c.label}</Text>
                <View style={[styles.badge, on && styles.badgeOn]}><Text style={[styles.badgeTxt, on && styles.badgeTxtOn]}>{c.count}</Text></View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
      <Text style={styles.listLabel}>{visible.length} {visible.length === 1 ? 'assembly' : 'assemblies'} {selectedStage === DONE ? 'done' : 'here'}</Text>
    </View>
  );

  const renderCard = ({ item }: { item: MOrderBoardItem }) => {
    const r = selectedStage && selectedStage !== DONE ? rowAt(item, selectedStage) : undefined;
    const ssColor = r ? (SS_COLOR[r.status] || Colors.medium) : Colors.medium;
    return (
      <TouchableOpacity style={styles.acard} onPress={() => navigation.navigate('AssemblyDetail', { orderId, projectId, nodeId: item.nodeId, mark: item.mark })}>
        <View style={styles.cardTop}>
          <Text style={styles.atag}>{item.nodeType === 'subassembly' ? 'SUB' : item.nodeType === 'part' ? 'PART' : 'ASM'}</Text>
          <Text style={styles.amark} numberOfLines={1}>{item.mark}</Text>
        </View>
        {r && (
          <View style={styles.arow}>
            <View style={[styles.dot, { backgroundColor: ssColor }]} />
            <Text style={styles.astatus}>{SS_LABEL[r.status] || r.status}</Text>
            {r.qtyTotal > 1 && <Text style={styles.acount}>{r.qtyDone}/{r.qtyTotal}</Text>}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  if (!board) return <View style={styles.center}><Text style={styles.muted}>Work order not found.</Text></View>;

  return (
    <>
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.list}
        data={visible}
        keyExtractor={(i) => i.nodeId}
        numColumns={2}
        columnWrapperStyle={styles.colWrap}
        ListHeaderComponent={Header}
        renderItem={renderCard}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        ListEmptyComponent={<View style={styles.empty}><Text style={styles.muted}>Nothing {selectedStage === DONE ? 'done yet' : 'at this stage'}.</Text></View>}
      />

      {/* QC report template picker — pick one, a blank report opens on the web to fill */}
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
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { padding: 24, alignItems: 'center' },
  muted: { color: Colors.textSecondary, marginVertical: 6, textAlign: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  stageBar: { paddingVertical: 4, paddingRight: 8, gap: 8, alignItems: 'center' },
  stageChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.light, borderRadius: 18, paddingVertical: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: Colors.border },
  stageChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  stageChipName: { color: Colors.text, fontSize: 13, fontWeight: '600', maxWidth: 140 },
  stageChipNameOn: { color: Colors.white },
  badge: { backgroundColor: Colors.card, borderRadius: 10, minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, alignItems: 'center' },
  badgeOn: { backgroundColor: 'rgba(255,255,255,0.25)' },
  badgeTxt: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary },
  badgeTxtOn: { color: Colors.white },
  listLabel: { marginTop: 14, marginBottom: 4, color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  colWrap: { gap: 10 },
  acard: { flex: 1, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  atag: { fontSize: 9, fontWeight: '800', color: Colors.primary, backgroundColor: Colors.light, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden' },
  amark: { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1 },
  arow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  astatus: { flex: 1, fontSize: 12, color: Colors.textSecondary },
  acount: { fontSize: 12, fontWeight: '700', color: Colors.text },
  // QC report template sheet
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
