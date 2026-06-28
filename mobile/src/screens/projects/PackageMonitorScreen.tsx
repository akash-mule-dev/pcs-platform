import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService, MImport, MImportsMonitor } from '../../services/projects.service';
import { PipelineStepper, ProgressBar, ImportStatusChip } from './ImportPipelineView';
import { fmtRelTime } from './monitor-format';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'PackageMonitor'>;
type Tab = 'active' | 'history';
const PAGE = 25;

/** Tenant-wide package monitor: org pulse (KPIs), live pipeline with queue
 *  positions, and the full upload history across every project. */
export function PackageMonitorScreen() {
  const navigation = useNavigation<Nav>();
  const [tab, setTab] = useState<Tab>('active');
  const [monitor, setMonitor] = useState<MImportsMonitor | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [history, setHistory] = useState<MImport[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<'asc' | 'desc'>('desc');
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadMonitor = useCallback(async () => {
    try { setMonitor(await projectsService.importsMonitor()); } catch { /* keep last */ }
  }, []);

  const loadHistory = useCallback(async (reset: boolean, nextSort?: 'asc' | 'desc') => {
    const useSort = nextSort ?? sort;
    const offset = reset ? 0 : history.length;
    setLoadingHistory(true);
    try {
      const page = await projectsService.importsHistory({ sort: useSort, limit: PAGE, offset });
      setHistory((prev) => (reset ? page.rows : [...prev, ...page.rows]));
      setTotal(page.total);
    } catch {
      /* keep what we have */
    } finally {
      setLoadingHistory(false);
    }
  }, [sort, history.length]);

  // Poll the org pulse while the screen is focused (KPIs shown on both tabs).
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const tick = async () => {
        try {
          const m = await projectsService.importsMonitor();
          if (alive) setMonitor(m);
        } catch { /* keep last */ }
      };
      tick();
      const t = setInterval(tick, 4000);
      return () => { alive = false; clearInterval(t); };
    }, []),
  );

  const switchTab = (next: Tab) => {
    setTab(next);
    if (next === 'history' && history.length === 0) loadHistory(true);
  };

  const flipSort = () => {
    const next = sort === 'desc' ? 'asc' : 'desc';
    setSort(next);
    loadHistory(true, next);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (tab === 'active') await loadMonitor();
    else await loadHistory(true);
    setRefreshing(false);
  };

  const openImport = (row: MImport) => {
    if (row.projectId) {
      navigation.navigate('ProjectMonitoring', { projectId: row.projectId, name: row.projectName || 'Project' });
    }
  };

  const kpis = monitor?.kpis;
  const active = monitor?.active ?? [];
  const hasMore = history.length < total;

  return (
    <View style={styles.screen}>
      {/* KPI strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.kpiStrip} contentContainerStyle={styles.kpiRow}>
        <Kpi label="Processing" value={kpis?.processing} color={Colors.primary} />
        <Kpi label="Queued" value={kpis?.queued} color={Colors.warning} />
        <Kpi label="Done today" value={kpis?.completedToday} color={Colors.success} />
        <Kpi label="Failed today" value={kpis?.failedToday} color={Colors.danger} />
        <Kpi label="Total" value={kpis?.totalPackages} color={Colors.medium} />
      </ScrollView>

      {/* Tabs */}
      <View style={styles.segWrap}>
        {(['active', 'history'] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[styles.seg, tab === t && styles.segOn]} onPress={() => switchTab(t)}>
            <Text style={[styles.segTxt, tab === t && styles.segTxtOn]}>
              {t === 'active' ? `In progress${active.length ? ` (${active.length})` : ''}` : 'History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {tab === 'active' ? (
          active.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={36} color={Colors.success} />
              <Text style={styles.muted}>Nothing in the pipeline right now.</Text>
            </View>
          ) : (
            active.map((imp) => (
              <TouchableOpacity key={imp.id} style={styles.card} activeOpacity={0.7} onPress={() => openImport(imp)}>
                <View style={styles.rowTop}>
                  <Text style={styles.proj} numberOfLines={1}>{imp.projectName || 'Project'}</Text>
                  {typeof imp.ahead === 'number' && imp.ahead > 0 && imp.stage === 'queued' ? (
                    <View style={styles.aheadChip}><Text style={styles.aheadTxt}>{imp.ahead} ahead</Text></View>
                  ) : (
                    <ImportStatusChip status={imp.status} />
                  )}
                </View>
                <Text style={styles.fileName} numberOfLines={1}>{imp.originalName}</Text>
                <PipelineStepper row={imp} />
                <ProgressBar percent={imp.progress} />
                <Text style={styles.cardMeta}>
                  {imp.progress}%{imp.nodeCount ? ` · ${imp.nodeCount} parts` : ''}
                  {imp.createdByName ? ` · ${imp.createdByName}` : ''}
                </Text>
              </TouchableOpacity>
            ))
          )
        ) : (
          <>
            <View style={styles.histBar}>
              <Text style={styles.histCount}>{total} upload{total === 1 ? '' : 's'}</Text>
              <TouchableOpacity style={styles.sortBtn} onPress={flipSort}>
                <Ionicons name={sort === 'desc' ? 'arrow-down' : 'arrow-up'} size={14} color={Colors.primary} />
                <Text style={styles.sortTxt}>{sort === 'desc' ? 'Newest' : 'Oldest'}</Text>
              </TouchableOpacity>
            </View>

            {history.length === 0 && !loadingHistory ? (
              <View style={styles.empty}><Text style={styles.muted}>No uploads yet.</Text></View>
            ) : (
              history.map((imp) => (
                <TouchableOpacity key={imp.id} style={styles.histRow} activeOpacity={0.7} onPress={() => openImport(imp)}>
                  <View style={styles.histMain}>
                    <Text style={styles.proj} numberOfLines={1}>{imp.projectName || 'Project'}</Text>
                    <Text style={styles.fileName} numberOfLines={1}>{imp.originalName}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {imp.nodeCount ? `${imp.nodeCount} parts · ` : ''}
                      {imp.modelId ? '3D ready · ' : ''}
                      {fmtRelTime(imp.createdAt)}
                    </Text>
                    {imp.status === 'failed' && !!imp.error && (
                      <Text style={styles.errTxt} numberOfLines={2}>{imp.error}</Text>
                    )}
                  </View>
                  <ImportStatusChip status={imp.status} />
                </TouchableOpacity>
              ))
            )}

            {loadingHistory && <ActivityIndicator color={Colors.primary} style={{ marginVertical: 14 }} />}
            {hasMore && !loadingHistory && (
              <TouchableOpacity style={styles.moreBtn} onPress={() => loadHistory(false)}>
                <Text style={styles.moreTxt}>Load more</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Kpi({ label, value, color }: { label: string; value?: number; color: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiVal, { color }]}>{value ?? '—'}</Text>
      <Text style={styles.kpiLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  kpiStrip: { flexGrow: 0, backgroundColor: Colors.card, borderBottomWidth: 1, borderBottomColor: Colors.border },
  kpiRow: { paddingHorizontal: 10, paddingVertical: 12, gap: 10 },
  kpi: { minWidth: 84, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.background, alignItems: 'center' },
  kpiVal: { fontSize: 20, fontWeight: '800' },
  kpiLbl: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  segWrap: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 4 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  segOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  segTxt: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  segTxtOn: { color: Colors.white },
  body: { flex: 1 },
  bodyContent: { padding: 12, paddingTop: 8, paddingBottom: 40 },
  empty: { padding: 36, alignItems: 'center', gap: 10 },
  muted: { color: Colors.textSecondary, textAlign: 'center' },
  card: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 14, marginBottom: 10, gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  proj: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text },
  fileName: { fontSize: 13, color: Colors.textSecondary },
  cardMeta: { fontSize: 12, color: Colors.textSecondary },
  aheadChip: { backgroundColor: Colors.warning, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  aheadTxt: { color: Colors.white, fontSize: 11, fontWeight: '700' },
  histBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  histCount: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.primary, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  sortTxt: { color: Colors.primary, fontWeight: '700', fontSize: 12 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 8 },
  histMain: { flex: 1 },
  errTxt: { color: Colors.danger, fontSize: 12, marginTop: 4 },
  moreBtn: { alignItems: 'center', paddingVertical: 12 },
  moreTxt: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
});
