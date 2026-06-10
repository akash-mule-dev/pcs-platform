import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService, MNode, MStage, ProdStatusColors, ProdStatusLabels } from '../../services/projects.service';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectDetail'>;
type Rt = RouteProp<ProjectsStackParamList, 'ProjectDetail'>;
type NodeKind = 'assembly' | 'subassembly' | 'part';

const TABS: { key: NodeKind; label: string }[] = [
  { key: 'assembly', label: 'Assemblies' },
  { key: 'subassembly', label: 'Sub assemblies' },
  { key: 'part', label: 'Parts' },
];

export function ProjectDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { projectId, name } = route.params;

  const [stages, setStages] = useState<MStage[]>([]);
  const [nodes, setNodes] = useState<MNode[]>([]);
  const [tab, setTab] = useState<NodeKind>('assembly');
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
      setStages(s || []);
      setNodes(n || []);
      // Auto-select the first tab that actually has items so the list is never blank by default.
      const firstWithItems = TABS.find((t) => (n || []).some((x) => x.nodeType === t.key));
      if (firstWithItems) setTab(firstWithItems.key);
    } catch (e: any) {
      setNodes([]);
      setError(e?.message || 'Could not load this project.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { group: 0, assembly: 0, subassembly: 0, part: 0 };
    for (const n of nodes) c[n.nodeType] = (c[n.nodeType] ?? 0) + 1;
    return c;
  }, [nodes]);

  const available = TABS.filter((t) => counts[t.key] > 0);
  const items = nodes.filter((n) => n.nodeType === tab);

  const Header = (
    <View>
      <Text style={styles.sectionTitle}>Process</Text>
      {stages.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pipeline}>
          {stages.map((s, i) => (
            <View key={s.id} style={styles.step}>
              <View style={styles.stepNum}><Text style={styles.stepNumTxt}>{i + 1}</Text></View>
              <Text style={styles.stepName} numberOfLines={1}>{s.name}</Text>
              {i < stages.length - 1 && <Text style={styles.stepArrow}>›</Text>}
            </View>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.muted}>No process attached yet. Attach one on the web (or generate work orders) to set the stage pipeline.</Text>
      )}

      {available.length > 0 && (
        <View style={styles.toggle}>
          {available.map((t) => (
            <TouchableOpacity key={t.key} style={[styles.tog, tab === t.key && styles.togActive]} onPress={() => setTab(t.key)}>
              <Text style={[styles.togTxt, tab === t.key && styles.togTxtActive]}>{t.label} ({counts[t.key]})</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  const renderCard = ({ item }: { item: MNode }) => {
    const color = ProdStatusColors[item.productionStatus] || Colors.medium;
    return (
      <TouchableOpacity
        style={styles.acard}
        onPress={() => navigation.navigate('AssemblyDetail', { projectId, nodeId: item.id, mark: item.mark || item.name })}
      >
        <Text style={styles.amark} numberOfLines={1}>{item.mark || item.name}</Text>
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
          ) : available.length === 0 ? (
            <Text style={styles.muted}>This project has {counts.group} structural group(s) but no assemblies or parts.</Text>
          ) : (
            <Text style={styles.muted}>No {tab === 'assembly' ? 'assemblies' : tab === 'subassembly' ? 'sub assemblies' : 'parts'} found.</Text>
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
  pipeline: { alignItems: 'center', paddingVertical: 4, paddingRight: 8 },
  step: { flexDirection: 'row', alignItems: 'center' },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { color: Colors.white, fontSize: 12, fontWeight: '700' },
  stepName: { marginLeft: 6, marginRight: 6, color: Colors.text, fontSize: 13, maxWidth: 120 },
  stepArrow: { color: Colors.medium, fontSize: 18, marginRight: 6 },
  toggle: { flexDirection: 'row', backgroundColor: Colors.light, borderRadius: 10, padding: 4, marginTop: 16, marginBottom: 8, flexWrap: 'wrap' },
  tog: { flex: 1, minWidth: 96, paddingVertical: 8, paddingHorizontal: 8, alignItems: 'center', borderRadius: 8 },
  togActive: { backgroundColor: Colors.card },
  togTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: 13 },
  togTxtActive: { color: Colors.primary },
  colWrap: { gap: 10 },
  acard: { flex: 1, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 10 },
  amark: { fontSize: 15, fontWeight: '700', color: Colors.text },
  aprofile: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  arow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  astatus: { flex: 1, fontSize: 12, color: Colors.textSecondary },
  apct: { fontSize: 12, fontWeight: '700', color: Colors.text },
});
