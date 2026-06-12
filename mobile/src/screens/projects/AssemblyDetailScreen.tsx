import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, TextInput, Modal, Linking, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import {
  ordersService, projectsService, qcReportsService,
  MNode, MNodeAudit, MAuditStageRow, MQualityEntry, MTemplate,
} from '../../services/projects.service';
import { timeTrackingService } from '../../services/time-tracking.service';
import { authService } from '../../services/auth.service';
import { environment } from '../../config/environment';
import { useAuth } from '../../context/AuthContext';
import { ProgressRing } from '../../components/ProgressRing';
import { TimeEntry } from '../../types';

type Rt = RouteProp<ProjectsStackParamList, 'AssemblyDetail'>;
type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'AssemblyDetail'>;

const QA_COLORS: Record<string, string> = { pass: '#2e7d32', warning: '#f9a825', fail: '#c62828' };
const ST_COLOR: Record<string, string> = { pending: '#9ca3af', in_progress: '#f9a825', completed: '#2e7d32', skipped: '#9ca3af' };
const ST_LABEL: Record<string, string> = { pending: 'Not started', in_progress: 'In progress', completed: 'Completed', skipped: 'Skipped' };
const STAGE_OPTS: { key: string; label: string }[] = [
  { key: 'pending', label: 'Not started' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Complete' },
];

function fmtDur(total: number): string {
  const v = Math.max(0, Math.floor(total));
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), s = v % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Assembly work screen (FabStation style): progress ring + stage breadcrumb
 * with prev/next, the selected stage's audit + controls (counts, status, skip),
 * a time TRACKER (clock in/out on this stage), AR / 3D / Info / Report tiles,
 * and the full trail — quality inspections, time entries and NCRs.
 */
export function AssemblyDetailScreen() {
  const route = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const { orderId, projectId, nodeId, mark } = route.params;
  const { user } = useAuth();
  const inspector = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || undefined;

  const [audit, setAudit] = useState<MNodeAudit | null>(null);
  const [node, setNode] = useState<MNode | null>(null);
  const [qa, setQa] = useState<MQualityEntry[]>([]);
  const [active, setActive] = useState<TimeEntry | null>(null); // my running entry on this assembly
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selStageId, setSelStageId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [qaBusy, setQaBusy] = useState(false);
  const [meas, setMeas] = useState({ value: '', unit: 'mm', min: '', max: '', notes: '' });
  const [trackBusy, setTrackBusy] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // QC report (per-assembly) template sheet
  const [tplVisible, setTplVisible] = useState(false);
  const [templates, setTemplates] = useState<MTemplate[]>([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);

  useLayoutEffect(() => { navigation.setOptions({ title: mark || 'Assembly' }); }, [navigation, mark]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [a, n, q] = await Promise.all([
        ordersService.nodeAudit(orderId, nodeId),
        projectsService.getNode(projectId, nodeId).catch(() => null),
        projectsService.getNodeQuality(projectId, nodeId).catch(() => [] as MQualityEntry[]),
      ]);
      setAudit(a); setNode(n); setQa(q);
      setSelStageId((cur) => {
        if (cur && a.stages.some((s) => s.stageId === cur)) return cur;
        const open = a.stages.find((s) => s.status === 'in_progress') ?? a.stages.find((s) => s.status === 'pending');
        return (open ?? a.stages[0])?.stageId ?? null;
      });
      // My running tracker on any stage of this assembly
      const wosIds = new Set(a.stages.map((s) => s.wosId));
      const act = await timeTrackingService.getActive().catch(() => [] as TimeEntry[]);
      setActive(act.find((e) => !e.endTime && wosIds.has(e.workOrderStageId) && (!user?.id || e.userId === user.id)) ?? null);
    } catch (e: any) {
      setAudit(null);
      setError(e?.message || 'Could not load this assembly.');
    } finally {
      setLoading(false);
    }
  }, [orderId, projectId, nodeId, user?.id]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Tick the running tracker every second while one is active.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const stages = audit?.stages ?? [];
  const selIdx = useMemo(() => Math.max(0, stages.findIndex((s) => s.stageId === selStageId)), [stages, selStageId]);
  const sel: MAuditStageRow | null = stages[selIdx] ?? null;
  const breadRef = useRef<ScrollView>(null);

  const pickStage = (i: number) => {
    if (i < 0 || i >= stages.length) return;
    setSelStageId(stages[i].stageId);
    breadRef.current?.scrollTo({ x: Math.max(0, i * 96 - 60), animated: true });
  };

  // ── Stage edit ──
  const setStage = async (s: MAuditStageRow, body: { qtyDone?: number; status?: string }) => {
    setBusy(true); setError(null);
    try { await ordersService.setStage(orderId, s.wosId, body); await load(); }
    catch (e: any) { setError(e?.message || 'Could not update the stage.'); }
    finally { setBusy(false); }
  };

  // ── Tracker (clock in/out on the selected stage) ──
  const startTracking = async () => {
    if (!sel || trackBusy) return;
    setTrackBusy(true); setError(null);
    try { await timeTrackingService.clockIn(sel.wosId); await load(); }
    catch (e: any) { setError(e?.message || 'Could not start tracking (already clocked in elsewhere?).'); }
    finally { setTrackBusy(false); }
  };
  const stopTracking = async () => {
    if (!active || trackBusy) return;
    setTrackBusy(true); setError(null);
    try { await timeTrackingService.clockOut(active.id); await load(); }
    catch (e: any) { setError(e?.message || 'Could not stop tracking.'); }
    finally { setTrackBusy(false); }
  };
  const activeStageName = active?.workOrderStage?.stage?.name
    ?? stages.find((s) => s.wosId === active?.workOrderStageId)?.name ?? 'a stage';
  const activeSeconds = active ? Math.floor((nowTick - new Date(active.startTime).getTime()) / 1000) : 0;

  // ── Tiles ──
  const open3d = () => {
    if (!node?.modelId) return;
    navigation.navigate('PartViewer', {
      projectId, nodeId, modelId: node.modelId, title: mark,
      profile: node.profile, materialGrade: node.materialGrade, lengthMm: node.lengthMm, weightKg: node.weightKg,
    });
  };
  const openAr = async () => {
    if (!node?.modelId) return;
    try {
      const meshes = await projectsService.getNodeMeshes(projectId, nodeId).catch(() => [] as string[]);
      (navigation.getParent() as any)?.navigate('Models', {
        screen: 'ARView',
        params: {
          modelId: node.modelId,
          fileUrl: `${environment.apiUrl}/models/${node.modelId}/file`,
          meshNames: meshes && meshes.length ? meshes : undefined,
          partLabel: mark,
        },
      });
    } catch { /* ignore */ }
  };
  const openReportSheet = async () => {
    setTplVisible(true);
    if (templates.length === 0) {
      setTplLoading(true);
      try { setTemplates(await qcReportsService.templates()); } catch { /* ignore */ }
      finally { setTplLoading(false); }
    }
  };
  const startReport = async (t: MTemplate) => {
    if (tplBusy) return;
    setTplBusy(true);
    try {
      const r = await qcReportsService.create({ templateId: t.id, productionOrderId: orderId, assemblyNodeId: nodeId });
      const token = (await authService.getToken()) ?? '';
      setTplVisible(false);
      await Linking.openURL(`${environment.webUrl}/qr/${r.id}?token=${encodeURIComponent(token)}`);
    } catch { Alert.alert('QC report', 'Could not start the report.'); }
    finally { setTplBusy(false); }
  };

  // ── Quality ──
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

  const specRows = useMemo(() => {
    const out: { k: string; v: string }[] = [];
    if (audit) out.push({ k: 'Work order', v: audit.workOrderNumber });
    if (node?.name && node.name !== mark) out.push({ k: 'Name', v: node.name });
    if (node?.profile) out.push({ k: 'Profile / section', v: node.profile });
    if (node?.materialGrade) out.push({ k: 'Material / grade', v: node.materialGrade });
    if (node?.lengthMm) out.push({ k: 'Length', v: `${Math.round(node.lengthMm)} mm` });
    if (node?.weightKg) out.push({ k: 'Weight', v: `${Math.round(node.weightKg * 10) / 10} kg` });
    if (node && node.quantity > 1) out.push({ k: 'Qty in design', v: `×${node.quantity}` });
    if (node?.ifcGuid) out.push({ k: 'IFC GUID', v: node.ifcGuid });
    return out;
  }, [node, audit, mark]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  if (!audit || !sel) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error || 'Assembly not found in this work order.'}</Text>
      </View>
    );
  }

  const total = sel.qtyTotal || 0;
  const totalTime = stages.reduce((a, s) => a + (s.timeSeconds || 0), 0);
  const isTrackingSel = !!active && active.workOrderStageId === sel.wosId;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      {/* ── Hero: ring + identity ── */}
      <View style={styles.hero}>
        <ProgressRing percent={audit.percentComplete} size={86} />
        <View style={styles.heroBody}>
          <Text style={styles.mark} numberOfLines={1}>{mark}</Text>
          <Text style={styles.woNum}>{audit.workOrderNumber}</Text>
          <View style={styles.heroChips}>
            <View style={[styles.chip, { backgroundColor: audit.status === 'completed' ? Colors.success : audit.status === 'in_progress' ? Colors.warning : Colors.medium }]}>
              <Text style={styles.chipTxt}>{audit.status === 'completed' ? 'Completed' : audit.status === 'in_progress' ? 'In progress' : 'Not started'}</Text>
            </View>
            {audit.ncrs.filter((n) => n.status !== 'closed' && n.status !== 'cancelled').length > 0 && (
              <View style={[styles.chip, { backgroundColor: Colors.danger }]}>
                <Text style={styles.chipTxt}>{audit.ncrs.filter((n) => n.status !== 'closed' && n.status !== 'cancelled').length} NCR</Text>
              </View>
            )}
          </View>
          <Text style={styles.heroMeta}>{audit.unitsDone}/{audit.unitsTotal} units · {fmtDur(totalTime)} logged</Text>
        </View>
      </View>

      {/* ── Tiles: AR / 3D / Info / Report ── */}
      <View style={styles.tiles}>
        <TouchableOpacity style={[styles.tile, !node?.modelId && styles.tileOff]} disabled={!node?.modelId} onPress={openAr}>
          <Ionicons name="scan-outline" size={26} color={node?.modelId ? Colors.tertiary : Colors.medium} />
          <Text style={styles.tileTxt}>AR</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tile, !node?.modelId && styles.tileOff]} disabled={!node?.modelId} onPress={open3d}>
          <Ionicons name="cube-outline" size={26} color={node?.modelId ? Colors.primary : Colors.medium} />
          <Text style={styles.tileTxt}>3D Viewer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tile} onPress={() => setInfoOpen(true)}>
          <Ionicons name="information-circle-outline" size={26} color={Colors.primary} />
          <Text style={styles.tileTxt}>Assembly Info</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tile} onPress={openReportSheet}>
          <Ionicons name="document-text-outline" size={26} color={Colors.primary} />
          <Text style={styles.tileTxt}>QC Report</Text>
        </TouchableOpacity>
      </View>
      {!node?.modelId && <Text style={styles.tileHint}>AR &amp; 3D unlock once the project model finishes converting.</Text>}

      {/* ── Stage breadcrumb + prev/next ── */}
      <View style={styles.crumbRow}>
        <TouchableOpacity style={[styles.navBtn, selIdx <= 0 && styles.navBtnOff]} disabled={selIdx <= 0} onPress={() => pickStage(selIdx - 1)}>
          <Ionicons name="arrow-back" size={18} color={selIdx <= 0 ? Colors.medium : Colors.white} />
        </TouchableOpacity>
        <ScrollView ref={breadRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
          {stages.map((s, i) => {
            const on = i === selIdx;
            const done = s.status === 'completed';
            const skipped = s.status === 'skipped';
            return (
              <TouchableOpacity key={s.wosId} style={styles.crumb} onPress={() => pickStage(i)}>
                <View style={[styles.crumbDot, done && styles.crumbDotDone, on && styles.crumbDotOn, skipped && styles.crumbDotSkip]}>
                  {done ? <Ionicons name="checkmark" size={13} color={Colors.white} />
                    : skipped ? <Ionicons name="play-skip-forward" size={11} color={Colors.white} />
                    : <Text style={[styles.crumbNum, on && styles.crumbNumOn]}>{i + 1}</Text>}
                </View>
                <Text style={[styles.crumbName, on && styles.crumbNameOn]} numberOfLines={2}>{s.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity style={[styles.navBtn, selIdx >= stages.length - 1 && styles.navBtnOff]} disabled={selIdx >= stages.length - 1} onPress={() => pickStage(selIdx + 1)}>
          <Ionicons name="arrow-forward" size={18} color={selIdx >= stages.length - 1 ? Colors.medium : Colors.white} />
        </TouchableOpacity>
      </View>

      {!!error && <Text style={styles.err}>{error}</Text>}

      {/* ── Selected stage card ── */}
      <View style={styles.stageCard}>
        <View style={styles.stageHead}>
          <Text style={styles.stageName}>{sel.name}</Text>
          <View style={[styles.chip, { backgroundColor: ST_COLOR[sel.status] || Colors.medium }]}>
            <Text style={styles.chipTxt}>{ST_LABEL[sel.status] || sel.status}</Text>
          </View>
          {busy && <ActivityIndicator size="small" color={Colors.primary} />}
          <View style={{ flex: 1 }} />
          <Text style={styles.stageQty}>{sel.qtyDone}<Text style={styles.stageQtyTot}>/{total}</Text></Text>
        </View>
        <View style={styles.stageTrack}>
          <View style={[styles.stageFill, sel.qtyDone >= total && total > 0 && { backgroundColor: Colors.success }, { width: `${total ? Math.min(100, (sel.qtyDone / total) * 100) : 0}%` as any }]} />
        </View>

        {/* controls */}
        {total > 1 ? (
          <View style={styles.stepRow}>
            <TouchableOpacity style={styles.stepBtn} disabled={busy || sel.status === 'skipped' || sel.qtyDone <= 0} onPress={() => setStage(sel, { qtyDone: sel.qtyDone - 1 })}><Text style={styles.stepTxt}>−</Text></TouchableOpacity>
            <TouchableOpacity style={styles.stepBtn} disabled={busy || sel.status === 'skipped' || sel.qtyDone >= total} onPress={() => setStage(sel, { qtyDone: sel.qtyDone + 1 })}><Text style={styles.stepTxt}>+</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.miniBtn, styles.allBtn]} disabled={busy || sel.status === 'completed'} onPress={() => setStage(sel, { status: 'completed' })}><Text style={styles.allTxt}>All</Text></TouchableOpacity>
            <TouchableOpacity style={styles.miniBtn} disabled={busy} onPress={() => setStage(sel, { status: 'pending' })}><Text style={styles.miniTxt}>Reset</Text></TouchableOpacity>
            {sel.status === 'skipped'
              ? <TouchableOpacity style={styles.miniBtn} disabled={busy} onPress={() => setStage(sel, { status: 'pending' })}><Text style={styles.miniTxt}>Unskip</Text></TouchableOpacity>
              : <TouchableOpacity style={styles.miniBtn} disabled={busy} onPress={() => setStage(sel, { status: 'skipped' })}><Text style={styles.miniTxt}>Skip</Text></TouchableOpacity>}
          </View>
        ) : (
          <View style={styles.segRow}>
            {STAGE_OPTS.map((o) => {
              const on = sel.status === o.key;
              return (
                <TouchableOpacity key={o.key} disabled={busy} style={[styles.seg, on && { backgroundColor: ST_COLOR[o.key], borderColor: ST_COLOR[o.key] }]} onPress={() => setStage(sel, { status: o.key })}>
                  <Text style={[styles.segTxt, on && styles.segTxtOn]}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
            {sel.status === 'skipped'
              ? <TouchableOpacity disabled={busy} style={styles.seg} onPress={() => setStage(sel, { status: 'pending' })}><Text style={styles.segTxt}>Unskip</Text></TouchableOpacity>
              : <TouchableOpacity disabled={busy} style={styles.seg} onPress={() => setStage(sel, { status: 'skipped' })}><Text style={styles.segTxt}>Skip</Text></TouchableOpacity>}
          </View>
        )}

        {/* audit meta */}
        <View style={styles.metaGrid}>
          <View style={styles.metaCell}><Text style={styles.metaK}>Started</Text><Text style={styles.metaV}>{fmtStamp(sel.startedAt)}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaK}>Completed</Text><Text style={styles.metaV}>{fmtStamp(sel.completedAt)}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaK}>Status updated</Text><Text style={styles.metaV}>{fmtStamp(sel.statusUpdatedAt)}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaK}>Assigned</Text><Text style={styles.metaV}>{sel.assignedUser?.name || '—'}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaK}>Station</Text><Text style={styles.metaV}>{sel.station?.name || '—'}</Text></View>
          <View style={styles.metaCell}><Text style={styles.metaK}>Stage time</Text><Text style={styles.metaV}>{fmtDur(sel.timeSeconds)}{sel.timeEntries ? ` (${sel.timeEntries})` : ''}</Text></View>
        </View>

        {/* tracker */}
        <View style={styles.tracker}>
          {active ? (
            <>
              <View style={[styles.trackDot, { backgroundColor: Colors.success }]} />
              <Text style={styles.trackTxt} numberOfLines={1}>
                Tracking {isTrackingSel ? 'this stage' : activeStageName} · {fmtDur(activeSeconds)}
              </Text>
              <TouchableOpacity style={[styles.trackBtn, { backgroundColor: Colors.danger }]} disabled={trackBusy} onPress={stopTracking}>
                {trackBusy ? <ActivityIndicator size="small" color={Colors.white} /> : (<><Ionicons name="stop" size={14} color={Colors.white} /><Text style={styles.trackBtnTxt}>Stop</Text></>)}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={[styles.trackDot, { backgroundColor: Colors.medium }]} />
              <Text style={styles.trackTxt}>No active tracker on this assembly</Text>
              <TouchableOpacity style={[styles.trackBtn, { backgroundColor: Colors.primary }]} disabled={trackBusy || sel.status === 'skipped'} onPress={startTracking}>
                {trackBusy ? <ActivityIndicator size="small" color={Colors.white} /> : (<><Ionicons name="play" size={14} color={Colors.white} /><Text style={styles.trackBtnTxt}>Start tracking</Text></>)}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* ── Quality ── */}
      <TouchableOpacity style={styles.secHead} onPress={() => setQaOpen((o) => !o)}>
        <Text style={styles.sectionTitle}>Quality{qa.length ? ` (${qa.length})` : ''}</Text>
        <Ionicons name={qaOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
      </TouchableOpacity>
      {qaOpen && (
        <View>
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
              <TextInput style={styles.measInput} placeholder="Defect / notes" placeholderTextColor={Colors.textSecondary} value={meas.notes} onChangeText={(v) => setMeas({ ...meas, notes: v })} />
              <TouchableOpacity style={[styles.qbtn, styles.qsave]} disabled={qaBusy || !meas.value} onPress={recordMeasure}><Text style={styles.qsaveT}>Save measurement</Text></TouchableOpacity>
              <Text style={styles.qaHint}>Out-of-tolerance auto-fails.</Text>
            </View>
          )}
          {qa.length === 0 ? <Text style={styles.muted}>No inspections yet.</Text> : (
            <View style={styles.listGap}>
              {qa.map((q) => (
                <View key={q.id} style={styles.rowItem}>
                  <View style={[styles.qaDot, { backgroundColor: QA_COLORS[q.status] || Colors.medium }]} />
                  <Text style={styles.rowMain}>{q.status}</Text>
                  {q.measurementValue != null && <Text style={styles.rowMeta}>{q.measurementValue}{q.measurementUnit || ''}</Text>}
                  {!!q.defectType && <Text style={styles.rowMeta} numberOfLines={1}>{q.defectType}</Text>}
                  <View style={{ flex: 1 }} />
                  <Text style={styles.rowMeta}>{q.inspector || ''}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* ── Time entries ── */}
      <Text style={styles.sectionTitle}>Time entries{audit.timeEntries.length ? ` (${audit.timeEntries.length})` : ''}</Text>
      {audit.timeEntries.length === 0 ? <Text style={styles.muted}>No time clocked on this assembly yet.</Text> : (
        <View style={styles.listGap}>
          {audit.timeEntries.map((te) => (
            <View key={te.id} style={styles.rowItem}>
              <Ionicons name={te.endTime ? 'time-outline' : 'play'} size={15} color={te.endTime ? Colors.textSecondary : Colors.success} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowMain} numberOfLines={1}>
                  {te.user || 'Unknown'}{te.isRework ? '  ·  REWORK' : ''}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {te.stageName || 'Stage'}{te.stationName ? ` @ ${te.stationName}` : ''} · {fmtStamp(te.startTime)}{te.endTime ? '' : ' · running'}
                </Text>
              </View>
              <Text style={styles.rowDur}>{te.durationSeconds != null ? fmtDur(te.durationSeconds) : '…'}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── NCRs ── */}
      <Text style={styles.sectionTitle}>NCRs{audit.ncrs.length ? ` (${audit.ncrs.length})` : ''}</Text>
      {audit.ncrs.length === 0 ? <Text style={styles.muted}>No NCRs raised against this assembly.</Text> : (
        <View style={styles.listGap}>
          {audit.ncrs.map((n) => (
            <TouchableOpacity key={n.id} style={styles.rowItem} onPress={() => (navigation.getParent() as any)?.navigate('More', { screen: 'NcrDetail', params: { id: n.id } })}>
              <Text style={styles.ncrNum}>{n.number}</Text>
              <Text style={[styles.rowMain, { flex: 1 }]} numberOfLines={1}>{n.title}</Text>
              <View style={[styles.chip, { backgroundColor: n.status === 'closed' ? Colors.success : Colors.danger }]}>
                <Text style={styles.chipTxt}>{n.status}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Assembly info sheet ── */}
      <Modal visible={infoOpen} transparent animationType="slide" onRequestClose={() => setInfoOpen(false)}>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{mark} — assembly info</Text>
              <TouchableOpacity onPress={() => setInfoOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={styles.sheetClose}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ marginTop: 8 }}>
              {specRows.length === 0 ? <Text style={styles.muted}>No details recorded for this assembly.</Text> : specRows.map((r) => (
                <View key={r.k} style={styles.specRow}>
                  <Text style={styles.specK}>{r.k}</Text>
                  <Text style={styles.specV} numberOfLines={2}>{r.v}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── QC report template sheet ── */}
      <Modal visible={tplVisible} transparent animationType="slide" onRequestClose={() => setTplVisible(false)}>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>QC report for {mark}</Text>
              <TouchableOpacity onPress={() => setTplVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={styles.sheetClose}>✕</Text></TouchableOpacity>
            </View>
            <Text style={styles.sheetSub}>Pick a template — a blank report opens in your browser, linked to this assembly.</Text>
            {tplLoading ? <ActivityIndicator color={Colors.primary} style={{ marginVertical: 20 }} /> : templates.length === 0 ? (
              <Text style={styles.muted}>No templates yet — create one in the web portal.</Text>
            ) : (
              <ScrollView style={{ marginTop: 2 }}>
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
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  muted: { color: Colors.textSecondary, marginVertical: 8 },
  err: { color: Colors.danger, fontSize: 13, marginBottom: 8 },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroBody: { flex: 1, minWidth: 0 },
  mark: { fontSize: 22, fontWeight: '800', color: Colors.text },
  woNum: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  heroChips: { flexDirection: 'row', gap: 6, marginTop: 7 },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  chipTxt: { color: Colors.white, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  heroMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 7 },

  tiles: { flexDirection: 'row', gap: 10, marginTop: 16 },
  tile: { flex: 1, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 6 },
  tileOff: { opacity: 0.45 },
  tileTxt: { fontSize: 11, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  tileHint: { fontSize: 11, color: Colors.textSecondary, marginTop: 6 },

  crumbRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 },
  navBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.secondary, alignItems: 'center', justifyContent: 'center' },
  navBtnOff: { backgroundColor: Colors.light, borderWidth: 1, borderColor: Colors.border },
  crumbs: { gap: 2, alignItems: 'flex-start', paddingVertical: 2 },
  crumb: { width: 92, alignItems: 'center', gap: 4 },
  crumbDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  crumbDotOn: { borderColor: Colors.primary },
  crumbDotDone: { backgroundColor: Colors.success, borderColor: Colors.success },
  crumbDotSkip: { backgroundColor: Colors.medium, borderColor: Colors.medium },
  crumbNum: { fontSize: 12, fontWeight: '800', color: Colors.textSecondary },
  crumbNumOn: { color: Colors.primary },
  crumbName: { fontSize: 10.5, fontWeight: '600', color: Colors.textSecondary, textAlign: 'center' },
  crumbNameOn: { color: Colors.primary, fontWeight: '800' },

  stageCard: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 14, marginTop: 12 },
  stageHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stageName: { fontSize: 17, fontWeight: '800', color: Colors.text },
  stageQty: { fontSize: 18, fontWeight: '800', color: Colors.text },
  stageQtyTot: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },
  stageTrack: { height: 8, backgroundColor: Colors.light, borderRadius: 5, overflow: 'hidden', marginTop: 10 },
  stageFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 5 },

  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  stepBtn: { width: 44, height: 38, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  stepTxt: { fontSize: 20, fontWeight: '700', color: Colors.text },
  miniBtn: { paddingHorizontal: 12, height: 38, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  miniTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: 13 },
  allBtn: { borderColor: '#2e7d32' },
  allTxt: { color: '#2e7d32', fontWeight: '700', fontSize: 13 },
  segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  seg: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: Colors.background, minWidth: 90, alignItems: 'center' },
  segTxt: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  segTxtOn: { color: Colors.white },

  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, rowGap: 10 },
  metaCell: { width: '33.33%', paddingRight: 8 },
  metaK: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3 },
  metaV: { fontSize: 12.5, fontWeight: '600', color: Colors.text, marginTop: 1 },

  tracker: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: Colors.light, borderRadius: 10, padding: 10 },
  trackDot: { width: 9, height: 9, borderRadius: 5 },
  trackTxt: { flex: 1, fontSize: 12.5, color: Colors.text, fontWeight: '600' },
  trackBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, paddingHorizontal: 12, height: 34, justifyContent: 'center' },
  trackBtnTxt: { color: Colors.white, fontWeight: '700', fontSize: 12 },

  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 18, marginBottom: 8 },
  listGap: { gap: 8 },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9 },
  rowMain: { color: Colors.text, fontWeight: '600', fontSize: 13, textTransform: 'capitalize' },
  rowMeta: { color: Colors.textSecondary, fontSize: 11.5 },
  rowDur: { color: Colors.text, fontWeight: '700', fontSize: 12.5 },
  ncrNum: { color: Colors.primary, fontWeight: '800', fontSize: 12.5 },
  qaDot: { width: 10, height: 10, borderRadius: 5 },

  qaActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  qbtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.card },
  qbtnT: { color: Colors.text, fontWeight: '600', fontSize: 13 },
  qpass: { borderColor: '#2e7d32' }, qpassT: { color: '#2e7d32', fontWeight: '700', fontSize: 13 },
  qwarn: { borderColor: '#f9a825' }, qwarnT: { color: '#b45309', fontWeight: '700', fontSize: 13 },
  qfail: { borderColor: '#c62828' }, qfailT: { color: '#c62828', fontWeight: '700', fontSize: 13 },
  qncr: { borderColor: Colors.primary }, qncrT: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  qsave: { borderColor: Colors.primary, alignItems: 'center' }, qsaveT: { color: Colors.primary, fontWeight: '700' },
  qaHint: { color: Colors.textSecondary, fontSize: 12 },
  measBox: { backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 10, marginBottom: 12, gap: 8 },
  measRow: { flexDirection: 'row', gap: 8 },
  measInput: { flex: 1, backgroundColor: Colors.white, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: Colors.text },

  specRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, gap: 12 },
  specK: { color: Colors.textSecondary, fontSize: 13, flexShrink: 0 },
  specV: { color: Colors.text, fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },

  sheetWrap: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 18, maxHeight: '75%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, flex: 1, marginRight: 8 },
  sheetClose: { fontSize: 16, color: Colors.textSecondary, fontWeight: '700' },
  sheetSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 4, marginBottom: 10 },
  tplRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tplName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  tplType: { fontSize: 11, color: Colors.textSecondary, textTransform: 'capitalize', marginTop: 1 },
  tplGo: { fontSize: 20, color: Colors.primary, fontWeight: '700', paddingHorizontal: 6 },
});
