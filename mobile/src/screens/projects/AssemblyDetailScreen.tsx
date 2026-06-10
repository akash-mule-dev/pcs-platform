import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, StatusColors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService, MNode, MNodeStages, MNodeStage, MQualityEntry, ProdStatusColors, ProdStatusLabels } from '../../services/projects.service';
import { useAuth } from '../../context/AuthContext';

type Rt = RouteProp<ProjectsStackParamList, 'AssemblyDetail'>;
type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'AssemblyDetail'>;

const NEXT: Record<string, string> = { pending: 'in_progress', in_progress: 'completed', completed: 'pending', skipped: 'pending' };
const ACTION: Record<string, string> = { pending: 'Start', in_progress: 'Complete', completed: 'Reset', skipped: 'Reset' };
const QA_COLORS: Record<string, string> = { pass: '#2e7d32', warning: '#f9a825', fail: '#c62828' };

export function AssemblyDetailScreen() {
  const route = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const { projectId, nodeId, mark } = route.params;
  const { user } = useAuth();
  const inspector = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || undefined;

  const [data, setData] = useState<MNodeStages | null>(null);
  const [node, setNode] = useState<MNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [qa, setQa] = useState<MQualityEntry[]>([]);
  const [qaBusy, setQaBusy] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [meas, setMeas] = useState({ value: '', unit: 'mm', min: '', max: '', notes: '' });

  useLayoutEffect(() => {
    navigation.setOptions({ title: mark || 'Assembly' });
  }, [navigation, mark]);

  const load = useCallback(async () => {
    try {
      const [stages, n, q] = await Promise.all([
        projectsService.getNodeStages(projectId, nodeId),
        projectsService.getNode(projectId, nodeId).catch(() => null),
        projectsService.getNodeQuality(projectId, nodeId).catch(() => [] as MQualityEntry[]),
      ]);
      setData(stages);
      setNode(n);
      setQa(q);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, nodeId]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const advance = async (st: MNodeStage) => {
    if (!st.id) return;
    setBusy(st.id);
    try {
      await projectsService.setNodeStage(projectId, nodeId, st.id, NEXT[st.status] || 'in_progress');
      await load();
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  };

  const openViewer = () => {
    if (!node?.modelId) return;
    navigation.navigate('PartViewer', {
      projectId,
      nodeId,
      modelId: node.modelId,
      title: mark,
      profile: node.profile,
      materialGrade: node.materialGrade,
      lengthMm: node.lengthMm,
      weightKg: node.weightKg,
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
        status: 'pass',
        measurementValue: value,
        measurementUnit: meas.unit || undefined,
        toleranceMin: meas.min ? parseFloat(meas.min) : undefined,
        toleranceMax: meas.max ? parseFloat(meas.max) : undefined,
        notes: meas.notes || undefined,
        inspector,
      });
      setMeas({ value: '', unit: 'mm', min: '', max: '', notes: '' });
      setMeasureOpen(false);
      await load();
    } catch { /* ignore */ } finally { setQaBusy(false); }
  };
  const openNcr = () => {
    (navigation.getParent() as any)?.navigate('More', {
      screen: 'NcrCreate',
      params: { projectId, nodeId, title: `${mark} — quality non-conformance`, severity: 'medium' },
    });
  };
  const openNcrFor = (q: MQualityEntry) => {
    (navigation.getParent() as any)?.navigate('More', {
      screen: 'NcrCreate',
      params: { projectId, nodeId, title: `${mark} — ${q.defectType || 'failed inspection'}`, severity: q.severity || 'medium', description: q.notes || undefined, qualityDataId: q.id },
    });
  };

  const specRows = (): { k: string; v: string }[] => {
    const out: { k: string; v: string }[] = [];
    if (node?.profile) out.push({ k: 'Profile / section', v: node.profile });
    if (node?.materialGrade) out.push({ k: 'Material / grade', v: node.materialGrade });
    if (node?.lengthMm) out.push({ k: 'Length', v: `${Math.round(node.lengthMm)} mm` });
    if (node?.weightKg) out.push({ k: 'Weight', v: `${Math.round(node.weightKg * 10) / 10} kg` });
    if (node && node.quantity > 1) out.push({ k: 'Quantity', v: `×${node.quantity}` });
    const props = node?.properties ? Object.entries(node.properties) : [];
    for (const [k, v] of props) {
      if (v == null || v === '') continue;
      if (out.some((r) => r.k === k)) continue;
      out.push({ k, v: String(v) });
    }
    return out;
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }
  if (!data) {
    return <View style={styles.center}><Text style={styles.muted}>Assembly not found.</Text></View>;
  }

  const pct = Math.round(data.percentComplete || 0);
  const statusColor = ProdStatusColors[data.nodeStatus] || Colors.medium;
  const currentIdx = data.stages.findIndex((s) => s.status !== 'completed' && s.status !== 'skipped');
  const rows = specRows();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      <View style={styles.hero}>
        <Text style={styles.mark}>{mark}</Text>
        <View style={[styles.chip, { backgroundColor: statusColor }]}>
          <Text style={styles.chipTxt}>{ProdStatusLabels[data.nodeStatus] || data.nodeStatus}</Text>
        </View>
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
        <Text style={styles.muted}>3D model not ready for this project yet (still converting, or not imported).</Text>
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

      <Text style={styles.sectionTitle}>Stages</Text>
      {data.stages.length === 0 && <Text style={styles.muted}>No stages yet — attach a process / generate work orders first.</Text>}
      {data.stages.map((s, i) => {
        const sc = StatusColors[s.status] || Colors.medium;
        const isCurrent = i === currentIdx;
        return (
          <View key={s.stageId} style={[styles.stage, isCurrent && styles.stageCurrent]}>
            <View style={[styles.seq, { backgroundColor: sc }]}><Text style={styles.seqTxt}>{i + 1}</Text></View>
            <View style={styles.stageBody}>
              <Text style={styles.stageName}>{s.name}</Text>
              <Text style={[styles.stageStatus, { color: sc }]}>{s.status.replace('_', ' ')}</Text>
            </View>
            {data.workOrderId && s.id ? (
              <TouchableOpacity style={styles.actionBtn} disabled={busy === s.id} onPress={() => advance(s)}>
                {busy === s.id ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.actionTxt}>{ACTION[s.status] || 'Start'}</Text>}
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}

      {!data.workOrderId && data.stages.length > 0 && (
        <Text style={styles.muted}>This assembly has no work order yet — generate work orders (web) to track and update its stages.</Text>
      )}
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
  stage: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 10 },
  stageCurrent: { borderColor: Colors.primary, borderWidth: 2 },
  seq: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  seqTxt: { color: Colors.white, fontWeight: '700' },
  stageBody: { flex: 1 },
  stageName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  stageStatus: { fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  actionBtn: { backgroundColor: Colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, minWidth: 84, alignItems: 'center' },
  actionTxt: { color: Colors.white, fontWeight: '700' },
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
});
