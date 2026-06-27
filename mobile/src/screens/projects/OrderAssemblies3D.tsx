import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { environment } from '../../config/environment';
import { projectsService, MNode, MOrderAudit } from '../../services/projects.service';
import { PartWebViewer } from './PartWebViewer';
import { PieceStatusSheet } from './PieceStatusSheet';
import { buildTreeIndex, displayName } from './assembly/treeIndex';
import { pieceColor, STATUS_LEGEND, hex } from './assembly/statusOverlay';

/**
 * The "3D" tab of a work order: this order's assemblies isolated in 3D and
 * painted by THIS order's production / ship status (the same per-order overlay
 * the project viewer offers, but scoped to one order and on by default). Tap a
 * piece to see its live status card and jump to the assembly. Geometry +
 * mesh→node mapping come from the project tree; status comes from the order
 * audit the board already loaded.
 */
export function OrderAssemblies3D({
  orderId,
  projectId,
  audit,
}: {
  orderId: string;
  projectId: string;
  audit: MOrderAudit;
}) {
  const navigation = useNavigation<any>();
  const [nodes, setNodes] = useState<MNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusOn, setStatusOn] = useState(true); // the point of this tab — on by default
  const [highlight, setHighlight] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    projectsService.getNodes(projectId)
      .then((n) => { if (alive) setNodes(n || []); })
      .catch(() => { if (alive) setNodes([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  const idx = useMemo(() => buildTreeIndex(nodes), [nodes]);
  const modelId = useMemo(() => nodes.find((n) => n.modelId)?.modelId ?? null, [nodes]);

  // Isolate the GLB to just this order's pieces (others hidden).
  const isolate = useMemo(() => {
    const set = new Set<string>();
    for (const it of audit.items) {
      if (!it.nodeId) continue;
      const n = idx.byId.get(it.nodeId);
      if (!n) continue;
      idx.descendantGuids(n).forEach((g) => set.add(g));
    }
    return [...set];
  }, [audit, idx]);

  // Paint each piece by its order status, propagated to descendant meshes.
  const statusColors = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const it of audit.items) {
      if (!it.nodeId) continue;
      const n = idx.byId.get(it.nodeId);
      if (!n) continue;
      const c = pieceColor(it);
      idx.descendantGuids(n).forEach((g) => { map[g] = c; });
    }
    return map;
  }, [audit, idx]);

  const selectedNode = selectedId ? idx.byId.get(selectedId) ?? null : null;
  const ancestorIds = useMemo(() => (selectedId ? idx.ancestorIds(selectedId) : []), [selectedId, idx]);

  const onMeshClicked = useCallback((name: string | null) => {
    if (!name) return;
    const n = idx.nodeByMesh.get(name);
    if (!n) { setHighlight([name]); return; }
    setHighlight(idx.descendantGuids(n));
    setSelectedId(n.id);
    setSheetOpen(true);
  }, [idx]);

  const openAr = useCallback(() => {
    if (!modelId) return;
    const meshes = selectedNode ? idx.descendantGuids(selectedNode) : isolate;
    navigation.navigate('ARView', {
      modelId,
      fileUrl: `${environment.apiUrl}/models/${modelId}/file`,
      meshNames: meshes.length ? meshes : undefined,
      partLabel: selectedNode ? displayName(selectedNode) : audit.order.number,
      // Carries the project so AR can colour-by Profile / Grade (needs node data).
      projectId,
    });
  }, [modelId, selectedNode, idx, isolate, navigation, audit.order.number, projectId]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }
  if (!modelId) {
    return (
      <View style={styles.center}>
        <Ionicons name="cube-outline" size={28} color={Colors.medium} />
        <Text style={styles.muted}>No 3D model yet — it appears once the project model finishes converting.</Text>
      </View>
    );
  }
  // An EMPTY isolate would make the viewer show the whole project (its "show
  // all" contract), not this order — so guard it explicitly. Happens when the
  // order's nodes carry no IFC GUID / mesh (geometry-only or ZIP imports).
  if (isolate.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="cube-outline" size={28} color={Colors.medium} />
        <Text style={styles.muted}>This order’s pieces aren’t linked to the 3D model — open the project 3D viewer to browse the full model.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.viewerBox}>
        <PartWebViewer
          modelId={modelId}
          isolate={isolate}
          highlight={highlight}
          colors={statusOn ? statusColors : {}}
          onMeshClicked={onMeshClicked}
        />
        <View style={styles.viewerBar} pointerEvents="box-none">
          <Text style={styles.viewerHint} numberOfLines={1}>
            {selectedNode
              ? displayName(selectedNode)
              : statusOn ? 'Coloured by this order’s status' : 'Tap a piece for its status'}
          </Text>
          <TouchableOpacity
            style={[styles.pill, statusOn && styles.pillOn]}
            onPress={() => setStatusOn((v) => !v)}
          >
            <Ionicons name="color-palette-outline" size={15} color={Colors.white} />
            <Text style={styles.pillTxt}>Status</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.pill, styles.pillAr]} onPress={openAr}>
            <Ionicons name="scan-outline" size={15} color={Colors.white} />
            <Text style={styles.pillTxt}>AR</Text>
          </TouchableOpacity>
        </View>
      </View>

      {statusOn && (
        <View style={styles.legend}>
          {STATUS_LEGEND.map((l) => (
            <View key={l.label} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: hex(l.c) }]} />
              <Text style={styles.legendTxt}>{l.label}</Text>
            </View>
          ))}
        </View>
      )}

      <PieceStatusSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        nodeId={selectedId}
        facts={selectedNode}
        ancestorIds={ancestorIds}
        onOpenAssembly={(oid, nodeId, mark) =>
          navigation.navigate('AssemblyDetail', { orderId: oid || orderId, projectId, nodeId, mark })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  muted: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center' },
  viewerBox: { flex: 1, backgroundColor: '#1a1a2e' },
  viewerBar: { position: 'absolute', left: 10, right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewerHint: { flex: 1, color: '#fff', fontSize: 12.5, fontWeight: '600', backgroundColor: 'rgba(13,17,23,0.6)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, overflow: 'hidden' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(13,17,23,0.72)', paddingHorizontal: 12, height: 34, borderRadius: 17, justifyContent: 'center' },
  pillOn: { backgroundColor: Colors.primary },
  pillAr: { backgroundColor: Colors.tertiary },
  pillTxt: { color: Colors.white, fontWeight: '700', fontSize: 13 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, rowGap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.card, borderTopWidth: 1, borderTopColor: Colors.border },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 11, height: 11, borderRadius: 3 },
  legendTxt: { fontSize: 11.5, color: Colors.textSecondary, fontWeight: '600' },
});
