import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { WO } from '../../theme/wo';
import { environment } from '../../config/environment';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService, ordersService, MNode, MOrder, MOrderAudit, MAuditItem } from '../../services/projects.service';
import { PartWebViewer } from './PartWebViewer';
import { PieceStatusSheet } from './PieceStatusSheet';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectDetail'>;

interface Row { node: MNode; depth: number; hasChildren: boolean }

// ── Production / ship-status readiness palette (one color per piece) ──
const C_NCR = 0xc62828;       // open NCR — ship blocked
const C_SHIPPED = 0x64748b;   // shipped
const C_LOADED = 0x1565c0;    // allocated to a load
const C_READY = 0x2e7d32;     // ready to ship
const C_PROD = 0xf9a825;      // in production
const C_NOT = 0x9aa7b0;       // not started

function pieceColor(item: MAuditItem): number {
  if (item.openNcrs > 0 || item.shipStatus === 'blocked_ncr') return C_NCR;
  if (item.shipStatus === 'shipped') return C_SHIPPED;
  if (item.shipStatus === 'allocated') return C_LOADED;
  if (item.shipStatus === 'ready') return C_READY;
  if (item.status === 'in_progress') return C_PROD;
  return C_NOT;
}

const LEGEND: { c: number; label: string }[] = [
  { c: C_NOT, label: 'Not started' },
  { c: C_PROD, label: 'In production' },
  { c: C_READY, label: 'Ready' },
  { c: C_LOADED, label: 'On a load' },
  { c: C_SHIPPED, label: 'Shipped' },
  { c: C_NCR, label: 'NCR' },
];

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  group: 'folder-outline', assembly: 'cube', subassembly: 'git-branch-outline', part: 'square-outline',
};

/** IFC exporters write "Undefined" for missing values — hide it. */
function defined(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t && t.toLowerCase() !== 'undefined' ? t : null;
}
function displayName(n: MNode): string {
  const name = (n.name ?? '').trim();
  if (name && name.toLowerCase() !== 'undefined') return name;
  return n.mark || `Unnamed ${n.nodeType}`;
}

/**
 * Project Assemblies tab: the assembly tree (search / collapse / drill) synced
 * with an embedded 3D viewer — the mobile front door for "find a piece by mark"
 * the app previously lacked (geometry was only reachable via a work order or QR
 * scan). Tap a tree row OR a part in 3D to highlight it and open its live
 * production-status card.
 */
export function ProjectAssemblies({ projectId }: { projectId: string }) {
  const navigation = useNavigation<Nav>();

  const [nodes, setNodes] = useState<MNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  // ── Status / readiness overlay ──
  const [orders, setOrders] = useState<MOrder[]>([]);
  const [statusOn, setStatusOn] = useState(false);
  const [statusOrderId, setStatusOrderId] = useState<string | null>(null);
  const [statusAudit, setStatusAudit] = useState<MOrderAudit | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusErr, setStatusErr] = useState<string | null>(null);

  const listRef = useRef<FlatList<Row>>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    projectsService.getNodes(projectId)
      .then((n) => { if (alive) setNodes(n || []); })
      .catch((e) => { if (alive) setError(e?.message || 'Could not load assemblies.'); })
      .finally(() => { if (alive) setLoading(false); });
    ordersService.listByProject(projectId)
      .then((o) => { if (alive) setOrders(o || []); })
      .catch(() => { if (alive) setOrders([]); });
    return () => { alive = false; };
  }, [projectId]);

  // Pick a sensible default order the first time the overlay is switched on.
  useEffect(() => {
    if (!statusOn || statusOrderId || orders.length === 0) return;
    const def = orders.find((o) => o.status === 'in_progress') ?? orders[0];
    setStatusOrderId(def?.id ?? null);
  }, [statusOn, statusOrderId, orders]);

  // Fetch the chosen order's audit (per-assembly ship/production status).
  useEffect(() => {
    if (!statusOn || !statusOrderId) { setStatusAudit(null); return; }
    let alive = true;
    setStatusLoading(true); setStatusErr(null);
    ordersService.audit(statusOrderId)
      .then((a) => { if (alive) setStatusAudit(a); })
      .catch((e) => { if (alive) { setStatusAudit(null); setStatusErr(e?.message || 'No access to this order’s status.'); } })
      .finally(() => { if (alive) setStatusLoading(false); });
    return () => { alive = false; };
  }, [statusOn, statusOrderId]);

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

  const selectNode = useCallback((n: MNode, openSheet: boolean) => {
    setSelectedId(n.id);
    setHighlight(descendantGuids(n));
    if (openSheet) setSheetOpen(true);
  }, [descendantGuids]);

  const onMeshClicked = useCallback((name: string | null) => {
    if (!name) return;
    const n = nodeByMesh.get(name);
    if (!n) { setHighlight([name]); return; }
    // Expand ancestors so the row is reachable, then scroll to it.
    setCollapsed((prev) => {
      if (!prev.size) return prev;
      const next = new Set(prev);
      let p = n.parentId; let changed = false;
      while (p) { if (next.delete(p)) changed = true; p = byId.get(p)?.parentId ?? null; }
      return changed ? next : prev;
    });
    selectNode(n, true);
  }, [nodeByMesh, byId, selectNode]);

  // Scroll the selected row into view when selection changes (not in search).
  useEffect(() => {
    if (!selectedId || query) return;
    const idx = rows.findIndex((r) => r.node.id === selectedId);
    if (idx >= 0) { try { listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.4, animated: true }); } catch {} }
  }, [selectedId, rows, query]);

  const toggle = (id: string) => setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(nodes.filter((n) => (childrenByParent.get(n.id)?.length ?? 0) > 0).map((n) => n.id)));

  // Per-mesh color map: each work order's status propagated to its assembly's
  // descendant part meshes (the join key is ifc_guid == mesh name).
  const statusColors = useMemo<Record<string, number>>(() => {
    if (!statusOn || !statusAudit) return {};
    const map: Record<string, number> = {};
    for (const item of statusAudit.items as MAuditItem[]) {
      if (!item.nodeId) continue;
      const node = byId.get(item.nodeId);
      if (!node) continue;
      const color = pieceColor(item);
      for (const g of descendantGuids(node)) map[g] = color;
    }
    return map;
  }, [statusOn, statusAudit, byId, descendantGuids]);

  const selectedNode = selectedId ? byId.get(selectedId) ?? null : null;
  const ancestorIds = useMemo(() => {
    if (!selectedId) return [];
    const out: string[] = [];
    let p = byId.get(selectedId)?.parentId ?? null;
    while (p) { out.push(p); p = byId.get(p)?.parentId ?? null; }
    return out;
  }, [selectedId, byId]);

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

  return (
    <View style={styles.container}>
      {/* Embedded synced 3D viewer */}
      {modelId ? (
        <View style={styles.viewerBox}>
          <PartWebViewer
            modelId={modelId}
            highlight={highlight}
            colors={statusOn ? statusColors : {}}
            onMeshClicked={onMeshClicked}
          />
          <View style={styles.viewerBar} pointerEvents="box-none">
            <Text style={styles.viewerHint} numberOfLines={1}>
              {selectedNode ? displayName(selectedNode) : statusOn ? 'Coloured by production status' : 'Tap a part or pick from the tree'}
            </Text>
            <TouchableOpacity
              style={[styles.statusBtn, statusOn && styles.statusBtnOn, orders.length === 0 && styles.statusBtnOff]}
              disabled={orders.length === 0}
              onPress={() => setStatusOn((v) => !v)}
            >
              <Ionicons name="color-palette-outline" size={15} color={Colors.white} />
              <Text style={styles.arTxt}>Status</Text>
            </TouchableOpacity>
            {selectedNode && (
              <TouchableOpacity style={styles.arBtn} onPress={openAr}>
                <Ionicons name="scan-outline" size={15} color={Colors.white} />
                <Text style={styles.arTxt}>AR</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.noViewer}>
          <Ionicons name="cube-outline" size={26} color={Colors.medium} />
          <Text style={styles.muted}>3D model is still converting — the tree is ready below.</Text>
        </View>
      )}

      {/* Status overlay controls: order picker + legend */}
      {statusOn && modelId && (
        <View style={styles.statusPanel}>
          {orders.length > 1 && (
            <View style={styles.orderChips}>
              {orders.map((o) => {
                const on = o.id === statusOrderId;
                return (
                  <TouchableOpacity key={o.id} style={[styles.orderChip, on && styles.orderChipOn]} onPress={() => setStatusOrderId(o.id)}>
                    <Text style={[styles.orderChipTxt, on && styles.orderChipTxtOn]} numberOfLines={1}>
                      {o.number}{o.customerName ? ` · ${o.customerName}` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {statusLoading ? (
            <View style={styles.statusInline}><ActivityIndicator size="small" color={Colors.primary} /><Text style={styles.muted}>Loading status…</Text></View>
          ) : statusErr ? (
            <Text style={styles.statusErr}>{statusErr}</Text>
          ) : (
            <View style={styles.legend}>
              {LEGEND.map((l) => (
                <View key={l.label} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: hex(l.c) }]} />
                  <Text style={styles.legendTxt}>{l.label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Search */}
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

      {/* Tools / match count */}
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
        onScrollToIndexFailed={() => {}}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.muted}>No matching items.</Text>}
      />

      <PieceStatusSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        nodeId={selectedId}
        facts={selectedNode}
        ancestorIds={ancestorIds}
        onOpenAssembly={(orderId, nodeId, mark) =>
          navigation.navigate('AssemblyDetail', { orderId, projectId, nodeId, mark })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  muted: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center' },

  viewerBox: { height: 280, backgroundColor: '#1a1a2e' },
  viewerBar: { position: 'absolute', left: 10, right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewerHint: { flex: 1, color: '#fff', fontSize: 12.5, fontWeight: '600', backgroundColor: 'rgba(13,17,23,0.6)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, overflow: 'hidden' },
  arBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.tertiary, paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: 'center' },
  arTxt: { color: Colors.white, fontWeight: '700', fontSize: 13 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(13,17,23,0.72)', paddingHorizontal: 12, height: 34, borderRadius: 17, justifyContent: 'center' },
  statusBtnOn: { backgroundColor: Colors.primary },
  statusBtnOff: { opacity: 0.4 },
  noViewer: { height: 120, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.card, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingHorizontal: 16 },

  statusPanel: { backgroundColor: Colors.card, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  orderChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  orderChip: { borderWidth: 1, borderColor: Colors.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: Colors.white },
  orderChipOn: { borderColor: Colors.primary, backgroundColor: '#e8f0fe' },
  orderChipTxt: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  orderChipTxtOn: { color: Colors.primary },
  statusInline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusErr: { fontSize: 12, color: Colors.danger },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, rowGap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 11, height: 11, borderRadius: 3 },
  legendTxt: { fontSize: 11.5, color: Colors.textSecondary, fontWeight: '600' },

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
