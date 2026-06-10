import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService, MNode, MStage, ProdStatusColors, ProdStatusLabels } from '../../services/projects.service';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectDetail'>;
type Rt = RouteProp<ProjectsStackParamList, 'ProjectDetail'>;
type TypeFilter = 'assembly' | 'part';
const DONE = '__done__';

export function ProjectDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { projectId, name } = route.params;

  const [stages, setStages] = useState<MStage[]>([]);
  const [nodes, setNodes] = useState<MNode[]>([]);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('assembly');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: name || 'Project' });
  }, [navigation, name]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, n] = await Promise.all([
        projectsService.getStages(projectId).catch(() => [] as MStage[]),
        projectsService.getNodes(projectId),
      ]);
      const sl = s || [];
      const nl = n || [];
      setStages(sl);
      setNodes(nl);
      const hasAsm = nl.some((x) => x.nodeType === 'assembly' || x.nodeType === 'subassembly');
      setTypeFilter(hasAsm ? 'assembly' : 'part');
      // Per request: the FIRST stage is selected by default.
      setSelectedStage(sl.length ? sl[0].id : null);
    } catch (e: any) {
      setNodes([]);
      setError(e?.message || 'Could not load this project.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const matchesType = useCallback(
    (n: MNode): boolean =>
      typeFilter === 'assembly'
        ? n.nodeType === 'assembly' || n.nodeType === 'subassembly'
        : n.nodeType === 'part',
    [typeFilter],
  );

  // Which stage an item currently sits in: Done if shipped/ready; else its own
  // current stage, else the nearest ancestor's (parts inherit), else the first
  // stage (everything not yet started waits at the front of the line).
  const stageOf = useCallback(
    (n: MNode): string => {
      if (n.productionStatus === 'ready_to_ship' || n.productionStatus === 'shipped') return DONE;
      let cur: MNode | undefined = n;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.currentStageId) return cur.currentStageId;
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return stages.length ? stages[0].id : DONE;
    },
    [byId, stages],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of nodes) {
      if (!matchesType(n)) continue;
      const k = stageOf(n);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [nodes, matchesType, stageOf]);

  const hasAsm = useMemo(() => nodes.some((n) => n.nodeType === 'assembly' || n.nodeType === 'subassembly'), [nodes]);
  const hasPart = useMemo(() => nodes.some((n) => n.nodeType === 'part'), [nodes]);

  const items = useMemo(
    () => nodes.filter((n) => matchesType(n) && (selectedStage == null || stageOf(n) === selectedStage)),
    [nodes, matchesType, stageOf, selectedStage],
  );

  const chips = useMemo(() => {
    const arr = stages.map((s, i) => ({ id: s.id, label: s.name, num: i + 1, count: counts[s.id] ?? 0 }));
    if ((counts[DONE] ?? 0) > 0) arr.push({ id: DONE, label: 'Done', num: arr.length + 1, count: counts[DONE] });
    return arr;
  }, [stages, counts]);

  const Header = (
    <View>
      <Text style={styles.sectionTitle}>Process — tap a stage</Text>
      {stages.length === 0 ? (
        <Text style={styles.muted}>No process attached yet. Attach one on the web (or generate work orders) to see stages here.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stageBar}>
          {chips.map((c) => {
            const on = selectedStage === c.id;
            return (
              <TouchableOpacity key={c.id} style={[styles.stageChip, on && styles.stageChipOn]} onPress={() => setSelectedStage(c.id)}>
                <Text style={[styles.stageChipName, on && styles.stageChipNameOn]} numberOfLines={1}>
                  {c.id === DONE ? '✓ ' : `${c.num}. `}{c.label}
                </Text>
                <View style={[styles.stageCount, on && styles.stageCountOn]}>
                  <Text style={[styles.stageCountTxt, on && styles.stageCountTxtOn]}>{c.count}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {hasAsm && hasPart && (
        <View style={styles.toggle}>
          <TouchableOpacity style={[styles.tog, typeFilter === 'assembly' && styles.togActive]} onPress={() => setTypeFilter('assembly')}>
            <Text style={[styles.togTxt, typeFilter === 'assembly' && styles.togTxtActive]}>Assemblies</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tog, typeFilter === 'part' && styles.togActive]} onPress={() => setTypeFilter('part')}>
            <Text style={[styles.togTxt, typeFilter === 'part' && styles.togTxtActive]}>Parts</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.listLabel}>
        {items.length} {typeFilter === 'assembly' ? 'assemblies' : 'parts'} {selectedStage === DONE ? 'done' : 'at this stage'}
      </Text>
    </View>
  );

  const renderCard = ({ item }: { item: MNode }) => {
    const color = ProdStatusColors[item.productionStatus] || Colors.medium;
    const tag = item.nodeType === 'subassembly' ? 'SUB' : item.nodeType === 'part' ? 'PART' : 'ASM';
    return (
      <TouchableOpacity
        style={styles.acard}
        onPress={() => navigation.navigate('AssemblyDetail', { projectId, nodeId: item.id, mark: item.mark || item.name })}
      >
        <View style={styles.cardTop}>
          <Text style={styles.atag}>{tag}</Text>
          <Text style={styles.amark} numberOfLines={1}>{item.mark || item.name}</Text>
        </View>
        {!!item.profile && <Text style={styles.aprofile} numberOfLines={1}>{item.profile}</Text>}
        <View style={styles.arow}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text style={styles.astatus} numberOfLines={1}>{ProdStatusLabels[item.productionStatus] || item.productionStatus}</Text>
          {item.percentComplete > 0 && <Text style={styles.apct}>{Math.round(item.percentComplete)}%</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <View style={styles.center}><Text style={styles.muted}>Loading…</Text></View>;
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(i) => i.id}
      numColumns={2}
      columnWrapperStyle={styles.colWrap}
      ListHeaderComponent={Header}
      renderItem={renderCard}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      ListEmptyComponent={
        <View style={styles.empty}>
          {error ? (
            <Text style={styles.err}>{error}</Text>
          ) : nodes.length === 0 ? (
            <Text style={styles.muted}>No assemblies in this project yet. Import an IFC on the web to build its assembly tree.</Text>
          ) : (
            <Text style={styles.muted}>No {typeFilter === 'assembly' ? 'assemblies' : 'parts'} {selectedStage === DONE ? 'done yet' : 'at this stage'}.</Text>
          )}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { padding: 24, alignItems: 'center' },
  muted: { color: Colors.textSecondary, marginVertical: 6, textAlign: 'center' },
  err: { color: Colors.danger, marginVertical: 6, textAlign: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  stageBar: { paddingVertical: 4, paddingRight: 8, gap: 8, alignItems: 'center' },
  stageChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.light, borderRadius: 18, paddingVertical: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: Colors.border },
  stageChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  stageChipName: { color: Colors.text, fontSize: 13, fontWeight: '600', maxWidth: 140 },
  stageChipNameOn: { color: Colors.white },
  stageCount: { backgroundColor: Colors.card, borderRadius: 10, minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, alignItems: 'center' },
  stageCountOn: { backgroundColor: 'rgba(255,255,255,0.25)' },
  stageCountTxt: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary },
  stageCountTxtOn: { color: Colors.white },
  toggle: { flexDirection: 'row', backgroundColor: Colors.light, borderRadius: 10, padding: 4, marginTop: 14 },
  tog: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  togActive: { backgroundColor: Colors.card },
  togTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: 13 },
  togTxtActive: { color: Colors.primary },
  listLabel: { marginTop: 14, marginBottom: 4, color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  colWrap: { gap: 10 },
  acard: { flex: 1, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  atag: { fontSize: 9, fontWeight: '800', color: Colors.primary, backgroundColor: Colors.light, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden' },
  amark: { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1 },
  aprofile: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  arow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  astatus: { flex: 1, fontSize: 12, color: Colors.textSecondary },
  apct: { fontSize: 12, fontWeight: '700', color: Colors.text },
});
