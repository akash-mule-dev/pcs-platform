import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { WO } from '../../theme/wo';
import { environment } from '../../config/environment';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService, MNode } from '../../services/projects.service';
import { PartWebViewer } from './PartWebViewer';
import { displayName, defined } from './assembly/treeIndex';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectViewer'>;

interface Row { node: MNode; depth: number; hasChildren: boolean }

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  group: 'folder-outline', assembly: 'cube', subassembly: 'git-branch-outline', part: 'square-outline',
};

/**
 * Project Assemblies & 3D — the assembly tree (left) synced with the 3D model
 * (right), mirroring the web portal's project viewer. A project is a pure DESIGN
 * container (no production status — that lives on work orders), so this view
 * carries no status overlay: tapping a tree row or a part highlights it, zooms
 * the camera to frame it (focus-on-selection), and shows its design facts.
 */
export function ProjectAssemblies({ projectId }: { projectId: string }) {
  const navigation = useNavigation<Nav>();
  const { width } = useWindowDimensions();
  const wide = width >= 700; // side-by-side (tablet) vs stacked (phone)

  const [nodes, setNodes] = useState<MNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [focusNonce, setFocusNonce] = useState(0); // bumped on TREE taps → flies the 3D camera to the part
  const [scrollNonce, setScrollNonce] = useState(0); // bumped on every selection → scrolls the tree to the row

  const listRef = useRef<FlatList<Row>>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    projectsService.getNodes(projectId)
      .then((n) => { if (alive) setNodes(n || []); })
      .catch((e) => { if (alive) setError(e?.message || 'Could not load assemblies.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  // ── Indexes ──
  const byId = useMemo(() => { const m = new Map<string, MNode>(); nodes.forEach((n) => m.set(n.id, n)); return m; }, [nodes]);
  const childrenByParent = useMemo(() => {
    const m = new Map<string, MNode[]>();
    nodes.forEach((n) => { if (n.parentId) { const a = m.get(n.parentId) ?? []; a.push(n); m.set(n.parentId, a); } });
    return m;
  }, [nodes]);
  const roots = useMemo(() => nodes.filter((n) => !n.parentId || !byId.has(n.parentId)), [nodes, byId]);
  const modelId = useMemo(() => nodes.find((n) => n.modelId)?.modelId ?? null, [nodes]);

  // Map a tapped mesh name (== ifc_guid / mesh_name) back to its node.
  const nodeByMesh = useMemo(() => {
    const m = new Map<string, MNode>();
    nodes.forEach((n) => { if (n.ifcGuid) m.set(n.ifcGuid, n); if (n.meshName) m.set(n.meshName, n); });
    return m;
  }, [nodes]);

  // ── Visible rows: pre-order DFS honouring collapsed; flat filtered list in search. ──
  const rows = useMemo<Row[]>(() => {
    const term = query.trim().toLowerCase();
    if (term) {
      return nodes
        .filter((n) => `${n.mark ?? ''} ${n.name ?? ''} ${n.profile ?? ''}`.toLowerCase().includes(term))
        .map((n) => ({ node: n, depth: 0, hasChildren: false }));
    }
    const out: Row[] = [];
    const walk = (n: MNode, depth: number) => {
      const kids = childrenByParent.get(n.id) ?? [];
      out.push({ node: n, depth, hasChildren: kids.length > 0 });
      if (collapsed.has(n.id)) return;
      kids.forEach((k) => walk(k, depth + 1));
    };
    roots.forEach((r) => walk(r, 0));
    return out;
  }, [nodes, roots, childrenByParent, collapsed, query]);

  const descendantGuids = useCallback((n: MNode): string[] => {
    const out: string[] = []; const stack = [n];
    while (stack.length) {
      const cur = stack.pop()!;
      const g = cur.ifcGuid || cur.meshName;
      if (g) out.push(g);
      (childrenByParent.get(cur.id) ?? []).forEach((c) => stack.push(c));
    }
    return out;
  }, [childrenByParent]);

  // focusCamera = fly the 3D camera to the part (TREE taps). A 3D tap selects +
  // scrolls the tree but must NOT move the camera (you tapped what you see).
  const selectNode = useCallback((n: MNode, focusCamera: boolean) => {
    setSelectedId(n.id);
    setHighlight(descendantGuids(n));
    setScrollNonce((v) => v + 1);
    if (focusCamera) setFocusNonce((v) => v + 1);
  }, [descendantGuids]);

  const onMeshClicked = useCallback((name: string | null) => {
    if (!name) return;
    const n = nodeByMesh.get(name);
    if (!n) { setHighlight([name]); return; }
    // Expand ancestors so the row is reachable, then scroll the tree to it.
    setCollapsed((prev) => {
      if (!prev.size) return prev;
      const next = new Set(prev);
      let p = n.parentId; let changed = false;
      while (p) { if (next.delete(p)) changed = true; p = byId.get(p)?.parentId ?? null; }
      return changed ? next : prev;
    });
    selectNode(n, false); // 3D tap → select + scroll tree, keep the camera put
  }, [nodeByMesh, byId, selectNode]);

  // Scroll the selected row into view on every selection (bump-driven so a
  // re-tap re-scrolls; rows in deps so it re-fires after ancestors expand).
  useEffect(() => {
    if (!selectedId || query) return;
    const idx = rows.findIndex((r) => r.node.id === selectedId);
    if (idx >= 0) { try { listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.4, animated: true }); } catch {} }
  }, [scrollNonce, rows, selectedId, query]);

  const toggle = (id: string) => setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(nodes.filter((n) => (childrenByParent.get(n.id)?.length ?? 0) > 0).map((n) => n.id)));

  const selectedNode = selectedId ? byId.get(selectedId) ?? null : null;
  const clearSelection = () => { setSelectedId(null); setHighlight([]); };

  const openAr = useCallback(() => {
    if (!modelId) return;
    const meshes = selectedNode ? descendantGuids(selectedNode) : [];
    navigation.navigate('ARView', {
      modelId,
      fileUrl: `${environment.apiUrl}/models/${modelId}/file`,
      meshNames: meshes.length ? meshes : undefined,
      partLabel: selectedNode ? displayName(selectedNode) : undefined,
    });
  }, [modelId, selectedNode, descendantGuids, navigation]);

  const renderRow = useCallback(({ item }: { item: Row }) => {
    const n = item.node;
    const sel = n.id === selectedId;
    const profile = defined(n.profile);
    const grade = defined(n.materialGrade);
    return (
      <TouchableOpacity
        style={[styles.row, sel && styles.rowSel, { paddingLeft: 8 + (query ? 0 : item.depth * 16) }]}
        onPress={() => selectNode(n, true)}
        activeOpacity={0.7}
      >
        {!query && item.hasChildren ? (
          <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); toggle(n.id); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name={collapsed.has(n.id) ? 'chevron-forward' : 'chevron-down'} size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        ) : <View style={styles.caretSpacer} />}
        <Ionicons name={TYPE_ICON[n.nodeType] || 'ellipse-outline'} size={16} color={n.nodeType === 'assembly' ? Colors.primary : Colors.textSecondary} />
        <Text style={styles.name} numberOfLines={1}>{displayName(n)}</Text>
        {!!n.mark && <Text style={styles.mark}>{n.mark}</Text>}
        {n.quantity > 1 && <Text style={styles.qty}>×{n.quantity}</Text>}
        {!!profile && <Text style={styles.meta} numberOfLines={1}>{profile}</Text>}
        {!!grade && <Text style={[styles.meta, styles.grade]} numberOfLines={1}>{grade}</Text>}
      </TouchableOpacity>
    );
  }, [selectedId, collapsed, query, selectNode]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  if (error) return <View style={styles.center}><Text style={styles.muted}>{error}</Text></View>;
  if (nodes.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="git-branch-outline" size={34} color={Colors.medium} />
        <Text style={styles.muted}>No assemblies yet. Import an IFC / model on the web — the structure and 3D appear here.</Text>
      </View>
    );
  }

  // ── Selected-piece design facts (no production status — this is a design view) ──
  const facts: string[] = [];
  if (selectedNode) {
    const p = defined(selectedNode.profile); if (p) facts.push(p);
    const g = defined(selectedNode.materialGrade); if (g) facts.push(g);
    if (selectedNode.lengthMm) facts.push(`${Math.round(selectedNode.lengthMm)} mm`);
    if (selectedNode.weightKg) facts.push(`${Math.round(selectedNode.weightKg * 10) / 10} kg`);
    if (selectedNode.quantity > 1) facts.push(`×${selectedNode.quantity}`);
  }

  const ViewerPane = (
    <View style={[styles.viewerPane, wide ? styles.viewerPaneWide : styles.viewerPaneTall]}>
      {modelId ? (
        <>
          <PartWebViewer
            modelId={modelId}
            highlight={highlight}
            autoFocus
            focusNonce={focusNonce}
            onMeshClicked={onMeshClicked}
          />
          {/* Design detail of the selection (no status) */}
          {selectedNode && (
            <View style={styles.detailCard} pointerEvents="box-none">
              <View style={styles.detailHead}>
                <Ionicons name={TYPE_ICON[selectedNode.nodeType] || 'ellipse-outline'} size={16} color={Colors.primary} />
                <Text style={styles.detailName} numberOfLines={1}>{displayName(selectedNode)}</Text>
                {!!selectedNode.mark && <Text style={styles.mark}>{selectedNode.mark}</Text>}
                <Text style={styles.detailType}>{selectedNode.nodeType}</Text>
                <TouchableOpacity onPress={clearSelection} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={18} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
              {facts.length > 0 && <Text style={styles.detailFacts}>{facts.join('  ·  ')}</Text>}
            </View>
          )}
          <View style={styles.viewerBar} pointerEvents="box-none">
            <Text style={styles.viewerHint} numberOfLines={1}>
              {selectedNode ? 'Zoomed to selection' : 'Tap a part or pick from the tree'}
            </Text>
            <TouchableOpacity style={styles.arBtn} onPress={openAr}>
              <Ionicons name="scan-outline" size={15} color={Colors.white} />
              <Text style={styles.arTxt}>AR</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <View style={styles.noViewer}>
          <Ionicons name="cube-outline" size={26} color={Colors.medium} />
          <Text style={styles.muted}>3D model is still converting — the tree is ready.</Text>
        </View>
      )}
    </View>
  );

  const TreePane = (
    <View style={[styles.treePane, wide && styles.treePaneWide]}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search mark, name or profile…"
          placeholderTextColor={Colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.toolsRow}>
        {query ? (
          <Text style={styles.toolsInfo}>{rows.length} match{rows.length === 1 ? '' : 'es'} — flat list</Text>
        ) : (
          <>
            <TouchableOpacity onPress={expandAll}><Text style={styles.link}>Expand all</Text></TouchableOpacity>
            <Text style={styles.sep}>·</Text>
            <TouchableOpacity onPress={collapseAll}><Text style={styles.link}>Collapse all</Text></TouchableOpacity>
          </>
        )}
      </View>

      <FlatList
        ref={listRef}
        style={styles.tree}
        data={rows}
        keyExtractor={(r) => r.node.id}
        renderItem={renderRow}
        initialNumToRender={30}
        windowSize={11}
        onScrollToIndexFailed={(info) => {
          // The target row isn't measured yet (common for far-down items): jump
          // approximately, let it render, then scroll precisely.
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
          setTimeout(() => {
            try { listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.4, animated: true }); } catch {}
          }, 280);
        }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.muted}>No matching items.</Text>}
      />
    </View>
  );

  // Web parity: tree LEFT, 3D RIGHT (tablet). Phones stack: 3D on top, tree below.
  return (
    <View style={[styles.container, wide && styles.splitRow]}>
      {wide ? (<>{TreePane}{ViewerPane}</>) : (<>{ViewerPane}{TreePane}</>)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  splitRow: { flexDirection: 'row' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  muted: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center' },

  // Panes
  treePane: { flex: 1, backgroundColor: Colors.background },
  treePaneWide: { flex: 0, width: 320, borderRightWidth: 1, borderRightColor: Colors.border },
  viewerPane: { backgroundColor: '#1a1a2e' },
  viewerPaneWide: { flex: 1 },
  viewerPaneTall: { height: 300 },

  viewerBar: { position: 'absolute', left: 10, right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewerHint: { flex: 1, color: '#fff', fontSize: 12.5, fontWeight: '600', backgroundColor: 'rgba(13,17,23,0.6)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, overflow: 'hidden' },
  arBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.tertiary, paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: 'center' },
  arTxt: { color: Colors.white, fontWeight: '700', fontSize: 13 },

  // Selection detail card (design facts only)
  detailCard: { position: 'absolute', left: 10, right: 10, top: 10, backgroundColor: 'rgba(13,17,23,0.92)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, gap: 4 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  detailName: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '700' },
  detailType: { color: '#9fb3c8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  detailFacts: { color: '#c7d6e6', fontSize: 12.5, fontWeight: '600' },

  noViewer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, margin: 12, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },
  toolsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 6 },
  toolsInfo: { fontSize: 12, color: Colors.textSecondary },
  link: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  sep: { color: Colors.textSecondary },

  tree: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingRight: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  rowSel: { backgroundColor: '#e8f0fe' },
  caretSpacer: { width: 16 },
  name: { fontSize: 13, fontWeight: '500', color: Colors.text, flexShrink: 1 },
  mark: { fontSize: 11.5, fontWeight: '700', color: WO.textSoft, backgroundColor: WO.muteBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  qty: { fontSize: 12, color: Colors.textSecondary },
  meta: { fontSize: 11.5, color: Colors.textSecondary, flexShrink: 1 },
  grade: { color: WO.good },
});
