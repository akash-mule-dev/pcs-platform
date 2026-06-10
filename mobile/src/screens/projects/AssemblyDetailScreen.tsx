import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { ordersService, projectsService, MNode, MOrderNodeStages, MOrderNodeStage, MQualityEntry } from '../../services/projects.service';
import { useAuth } from '../../context/AuthContext';

type Rt = RouteProp<ProjectsStackParamList, 'AssemblyDetail'>;
type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'AssemblyDetail'>;

const QA_COLORS: Record<string, string> = { pass: '#2e7d32', warning: '#f9a825', fail: '#c62828' };
const ND_COLOR: Record<string, string> = { not_started: '#9ca3af', in_progress: '#f9a825', completed: '#2e7d32' };
const ND_LABEL: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Complete' };
const STAGE_COLOR: Record<string, string> = { pending: '#9ca3af', in_progress: '#f9a825', completed: '#2e7d32', skipped: '#9ca3af' };
const STAGE_OPTS: { key: string; label: string }[] = [
  { key: 'pending', label: 'Not started' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Complete' },
];

export function AssemblyDetailScreen() {
  const route = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const { orderId, projectId, nodeId, mark } = route.params;
  const { user } = useAuth();
  const inspector = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || undefined;

  const [data, setData] = useState<MOrderNodeStages | null>(null);
  const [node, setNode] = useState<MNode | null>(null);
  const [qa, setQa] = useState<MQualityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [qaBusy, setQaBusy] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [meas, setMeas] = useState({ value: '', unit: 'mm', min: '', max: '', notes: '' });

  useLayoutEffect(() => { navigation.setOptions({ title: mark || 'Assembly' }); }, [navigation, mark]);

  const load = useCallback(async () => {
    try {
      const [d, n, q] = await Promise.all([
        ordersService.nodeStages(orderId, nodeId),
        projectsService.getNode(projectId, nodeId).catch(() => null),
        projectsService.getNodeQuality(projectId, nodeId).catch(() => [] as MQualityEntry[]),
      ]);
      setData(d); setNode(n); setQa(q);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [orderId, projectId, nodeId]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Update one stage independently — quantity stepper (qtyDone) or qty=1 status.
  const setStage = async (s: MOrderNodeStage, body: { qtyDone?: number; status?: string }) => {
    setBusy(s.id);
    try { await ordersService.setStage(orderId, s.id, body); await load(); }
    catch { /* ignore */ } finally { setBusy(null); }
  };

  const openViewer = () => {
    if (!node?.modelId) return;
    navigation.navigate('PartViewer', {
      projectId, nodeId, modelId: node.modelId, title: mark,
      profile: node.profile, materialGrade: node.materialGrade, lengthMm: node.lengthMm, weightKg: node.weightKg,
    });
  };

  const recordQuick = async (status: string) => {
    setQaBusy(true);
    try { await projectsService.recordNodeQuality(projectId, nodeId, { status, inspector }); await load(); }
    catch { /* ignore */ } finally { setQaBusy(false); }
  };
  const recordMeasure = async () => {
    const value = parseFloat(meas.value);
    if (isNaN(value)) return;
    setQaBusy(true);
    try {
      await projectsService.recordNodeQuality(projectId, nodeId, {
        status: 'pass', measurementValue: value, measurementUnit: meas.unit || undefined,
        toleranceMin: meas.min ? parseFloat(meas.min) : undefined, toleranceMax: meas.max ? parseFloat(meas.max) : undefined,
        notes: meas.notes || undefined, inspector,
      });
      setMeas({ value: '', unit: 'mm', min: '', max: '', notes: '' });
      setMeasureOpen(false); await load();
    } catch { /* ignore */ } finally { setQaBusy(false); }
  };
  const openNcr = () => (navigation.getParent() as any)?.navigate('More', { screen: 'NcrCreate', params: { projectId, nodeId, title: `${mark} — quality non-conformance`, severity: 'medium' } });
  const openNcrFor = (q: MQualityEntry) => (navigation.getParent() as any)?.navigate('More', { screen: 'NcrCreate', params: { projectId, nodeId, title: `${mark} — ${q.defectType || 'failed inspection'}`, severity: q.severity || 'medium', description: q.notes || undefined, qualityDataId: q.id } });

  const specRows = (): { k: string; v: string }[] => {
    const out: { k: string; v: string }[] = [];
    if (node?.profile) out.push({ k: 'Profile / section', v: node.profile });
    if (node?.materialGrade) out.push({ k: 'Material / grade', v: node.materialGrade });
    if (node?.lengthMm) out.push({ k: 'Length', v: `${Math.round(node.lengthMm)} mm` });
    if (node?.weightKg) out.push({ k: 'Weight', v: `${Math.round(node.weightKg * 10) / 10} kg` });
    if (node && node.quantity > 1) out.push({ k: 'Qty in design', v: `×${node.quantity}` });
    return out;
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  if (!data) return <View style={styles.center}><Text style={styles.muted}>Assembly not found.</Text></View>;

  const pct = Math.round(data.percentComplete || 0);
  const ndColor = ND_COLOR[data.nodeStatus] || Colors.medium;
  const rows = specRows();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}>
      <View style={styles.hero}>
        <Text style={styles.mark}>{mark}</Text>
        <View style={[styles.chip, { backgroundColor: ndColor }]}><Text style={styles.chipTxt}>{ND_LABEL[data.nodeStatus] || data.nodeStatus}</Text></View>
      </View>

      <View style={styles.progRow}>
        <View style={styles.progTrack}><View style={[styles.progFill, { width: (`${pct}%` as any) }]} /></View>
        <Text style={styles.progPct}>{pct}%</Text>
      </View>

      {node?.modelId ? (
        <TouchableOpacity style={styles.view3d} onPress={openViewer}>
          <Ionicons name="cube-outline" size={20} color={Colors.white} />
          <Text style={styles.view3dTxt}>View in 3D</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.muted}>3D model not ready for this project yet.</Text>
      )}

      <Text style={styles.sectionTitle}>Spec &amp; dimensions</Text>
      {rows.length === 0 ? (
        <Text style={styles.muted}>No dimensions recorded for this item.</Text>
      ) : (
        <View style={styles.specCard}>
          {rows.map((r) => (
            <View key={r.k} style={styles.specRow}>
              <Text style={styles.specK} numberOfLines={1}>{r.k}</Text>
              <Text style={styles.specV} numberOfLines={1}>{r.v}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>Quality</Text>
      <View style={styles.qaActions}>
        <TouchableOpacity style={[styles.qbtn, styles.qpass]} disabled={qaBusy} onPress={() => recordQuick('pass')}><Text style={styles.qpassT}>Pass</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.qbtn, styles.qwarn]} disabled={qaBusy} onPress={() => recordQuick('warning')}><Text style={styles.qwarnT}>Warning</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.qbtn, styles.qfail]} disabled={qaBusy} onPress={() => recordQuick('fail')}><Text style={styles.qfailT}>Fail</Text></TouchableOpacity>
        <TouchableOpacity style={styles.qbtn} onPress={() => setMeasureOpen((o) => !o)}><Text style={styles.qbtnT}>Measure</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.qbtn, styles.qncr]} onPress={openNcr}><Text style={styles.qncrT}>Raise NCR</Text></TouchableOpacity>
      </View>
      {measureOpen && (
        <View style={styles.measBox}>
          <View style={styles.measRow}>
            <TextInput style={styles.measInput} keyboardType="numeric" placeholder="Value" placeholderTextColor={Colors.textSecondary} value={meas.value} onChangeText={(v) => setMeas({ ...meas, value: v })} />
            <TextInput style={styles.measInput} placeholder="Unit" placeholderTextColor={Colors.textSecondary} value={meas.unit} onChangeText={(v) => setMeas({ ...meas, unit: v })} />
          </View>
          <View style={styles.measRow}>
            <TextInput style={styles.measInput} keyboardType="numeric" placeholder="Tol min" placeholderTextColor={Colors.textSecondary} value={meas.min} onChangeText={(v) => setMeas({ ...meas, min: v })} />
            <TextInput style={styles.measInput} keyboardType="numeric" placeholder="Tol max" placeholderTextColor={Colors.textSecondary} value={meas.max} onChangeText={(v) => setMeas({ ...meas, max: v })} />
          </View>
          <TextInput style={[styles.measInput, styles.measNotes]} placeholder="Defect / notes" placeholderTextColor={Colors.textSecondary} value={meas.notes} onChangeText={(v) => setMeas({ ...meas, notes: v })} />
          <TouchableOpacity style={[styles.qbtn, styles.qsave]} disabled={qaBusy || !meas.value} onPress={recordMeasure}><Text style={styles.qsaveT}>Save measurement</Text></TouchableOpacity>
          <Text style={styles.qaHint}>Out-of-tolerance auto-fails.</Text>
        </View>
      )}
      {qa.length === 0 ? (
        <Text style={styles.muted}>No inspections yet.</Text>
      ) : (
        <View style={styles.qaList}>
          {qa.map((q) => (
            <View key={q.id} style={styles.qaItem}>
              <View style={[styles.qaDot, { backgroundColor: QA_COLORS[q.status] || Colors.medium }]} />
              <Text style={styles.qaStatus}>{q.status}</Text>
              {q.measurementValue != null && <Text style={styles.qaMeta}>{q.measurementValue}{q.measurementUnit || ''}</Text>}
              {!!q.defectType && <Text style={styles.qaMeta}>{q.defectType}</Text>}
              <View style={{ flex: 1 }} />
              {q.status === 'fail' && <TouchableOpacity onPress={() => openNcrFor(q)}><Text style={styles.qaNcrLink}>NCR</Text></TouchableOpacity>}
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>Stages — set each independently</Text>
      {data.stages.length === 0 && <Text style={styles.muted}>No stages for this assembly in this work order.</Text>}
      {data.stages.map((s) => {
        const sc = STAGE_COLOR[s.status] || Colors.medium;
        const total = s.qtyTotal || 0;
        const busyThis = busy === s.id;
        return (
          <View key={s.id} style={styles.stage}>
            <View style={[styles.seq, { backgroundColor: sc }]} />
            <View style={styles.stageBody}>
              <View style={styles.stageHead}>
                <Text style={styles.stageName}>{s.name}</Text>
                {total > 1 && <Text style={styles.count}>{s.qtyDone}/{total}</Text>}
                {busyThis && <ActivityIndicator size="small" color={Colors.primary} />}
              </View>
              {total > 1 ? (
                <View style={styles.stepRow}>
                  <TouchableOpacity style={styles.stepBtn} disabled={busyThis || s.qtyDone <= 0} onPress={() => setStage(s, { qtyDone: s.qtyDone - 1 })}><Text style={styles.stepTxt}>−</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.stepBtn} disabled={busyThis || s.qtyDone >= total} onPress={() => setStage(s, { qtyDone: s.qtyDone + 1 })}><Text style={styles.stepTxt}>+</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.miniBtn, styles.allBtn]} disabled={busyThis} onPress={() => setStage(s, { status: 'completed' })}><Text style={styles.allTxt}>All</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.miniBtn} disabled={busyThis} onPress={() => setStage(s, { status: 'pending' })}><Text style={styles.miniTxt}>Reset</Text></TouchableOpacity>
                </View>
              ) : (
                <View style={styles.segRow}>
                  {STAGE_OPTS.map((o) => {
                    const on = s.status === o.key;
                    return (
                      <TouchableOpacity key={o.key} disabled={busyThis} style={[styles.seg, on && { backgroundColor: STAGE_COLOR[o.key], borderColor: STAGE_COLOR[o.key] }]} onPress={() => setStage(s, { status: o.key })}>
                        <Text style={[styles.segTxt, on && styles.segTxtOn]}>{o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  muted: { color: Colors.textSecondary, marginVertical: 8 },
  hero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mark: { fontSize: 22, fontWeight: '700', color: Colors.text, flex: 1, marginRight: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipTxt: { color: Colors.white, fontSize: 12, fontWeight: '700' },
  progRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 12 },
  progTrack: { flex: 1, height: 10, backgroundColor: Colors.border, borderRadius: 6, overflow: 'hidden' },
  progFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 6 },
  progPct: { marginLeft: 12, fontSize: 16, fontWeight: '700', color: Colors.text },
  view3d: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, height: 46, borderRadius: 10, marginBottom: 8 },
  view3dTxt: { color: Colors.white, fontWeight: '700', fontSize: 15 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 16, marginBottom: 8 },
  specCard: { backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 4 },
  specRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, gap: 12 },
  specK: { color: Colors.textSecondary, fontSize: 13, flexShrink: 1 },
  specV: { color: Colors.text, fontSize: 13, fontWeight: '600', maxWidth: '60%' },
  qaActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  qbtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.card },
  qbtnT: { color: Colors.text, fontWeight: '600', fontSize: 13 },
  qpass: { borderColor: '#2e7d32' }, qpassT: { color: '#2e7d32', fontWeight: '700', fontSize: 13 },
  qwarn: { borderColor: '#f9a825' }, qwarnT: { color: '#b45309', fontWeight: '700', fontSize: 13 },
  qfail: { borderColor: '#c62828' }, qfailT: { color: '#c62828', fontWeight: '700', fontSize: 13 },
  qncr: { borderColor: Colors.primary }, qncrT: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  measBox: { backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 10, marginBottom: 12, gap: 8 },
  measRow: { flexDirection: 'row', gap: 8 },
  measInput: { flex: 1, backgroundColor: Colors.white, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: Colors.text },
  measNotes: { flex: 0 },
  qsave: { borderColor: Colors.primary, alignItems: 'center' }, qsaveT: { color: Colors.primary, fontWeight: '700' },
  qaHint: { color: Colors.textSecondary, fontSize: 12 },
  qaList: { gap: 8, marginBottom: 12 },
  qaItem: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  qaDot: { width: 10, height: 10, borderRadius: 5 },
  qaStatus: { textTransform: 'capitalize', color: Colors.text, fontWeight: '600', fontSize: 13 },
  qaMeta: { color: Colors.textSecondary, fontSize: 12 },
  qaNcrLink: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  stage: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 10 },
  seq: { width: 12, height: 12, borderRadius: 6, marginRight: 12, marginTop: 4 },
  stageBody: { flex: 1 },
  stageHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stageName: { fontSize: 15, fontWeight: '600', color: Colors.text, flex: 1 },
  count: { fontSize: 14, fontWeight: '700', color: Colors.text },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  stepBtn: { width: 40, height: 36, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  stepTxt: { fontSize: 20, fontWeight: '700', color: Colors.text },
  miniBtn: { paddingHorizontal: 12, height: 36, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  miniTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: 13 },
  allBtn: { borderColor: '#2e7d32' },
  allTxt: { color: '#2e7d32', fontWeight: '700', fontSize: 13 },
  segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  seg: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: Colors.background, minWidth: 92, alignItems: 'center' },
  segTxt: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  segTxtOn: { color: Colors.white },
});
