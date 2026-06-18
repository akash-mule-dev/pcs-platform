import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { environment } from '../../config/environment';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService, MNode } from '../../services/projects.service';
import { PartWebViewer } from './PartWebViewer';
import { PieceStatusSheet, PieceFacts } from './PieceStatusSheet';

type Rt = RouteProp<ProjectsStackParamList, 'PartViewer'>;

/**
 * 3D viewer for one assembly/part: isolates the node's descendant meshes and
 * (via the shared PartWebViewer enabler) lets the user TAP any member to see its
 * live production-status card — the spatial twin of the QR-scan resolve flow.
 */
export function PartViewerScreen() {
  const route = useRoute<Rt>();
  const navigation = useNavigation<any>();
  const { projectId, nodeId, modelId, title, profile, materialGrade, lengthMm, weightKg } = route.params;

  // null = still resolving which meshes to isolate; [] = show the whole model.
  const [meshNames, setMeshNames] = useState<string[] | null>(null);
  const [nodes, setNodes] = useState<MNode[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [sheetNodeId, setSheetNodeId] = useState<string | null>(null);
  const [sheetFacts, setSheetFacts] = useState<PieceFacts | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const fileUrl = `${environment.apiUrl}/models/${modelId}/file`;

  useEffect(() => {
    let alive = true;
    projectsService.getNodeMeshes(projectId, nodeId)
      .then((names) => { if (alive) setMeshNames(names || []); })
      .catch(() => { if (alive) setMeshNames([]); });
    // Loaded for tap → node resolution (map mesh name to its assembly node).
    projectsService.getNodes(projectId)
      .then((n) => { if (alive) setNodes(n || []); })
      .catch(() => { if (alive) setNodes([]); });
    return () => { alive = false; };
  }, [projectId, nodeId]);

  const nodeByMesh = useMemo(() => {
    const m = new Map<string, MNode>();
    nodes.forEach((n) => { if (n.ifcGuid) m.set(n.ifcGuid, n); if (n.meshName) m.set(n.meshName, n); });
    return m;
  }, [nodes]);
  const byId = useMemo(() => { const m = new Map<string, MNode>(); nodes.forEach((n) => m.set(n.id, n)); return m; }, [nodes]);
  const ancestorIds = useMemo(() => {
    if (!sheetNodeId) return [];
    const out: string[] = [];
    let p = byId.get(sheetNodeId)?.parentId ?? null;
    while (p) { out.push(p); p = byId.get(p)?.parentId ?? null; }
    return out;
  }, [sheetNodeId, byId]);

  const routeFacts: PieceFacts = { mark: title, profile, materialGrade, lengthMm, weightKg };

  const onMeshClicked = useCallback((name: string | null) => {
    if (!name) return;
    const n = nodeByMesh.get(name);
    if (n) {
      setHighlight([name]);
      setSheetNodeId(n.id);
      setSheetFacts(n);
    } else {
      // Fall back to the assembly this viewer was opened for.
      setHighlight([name]);
      setSheetNodeId(nodeId);
      setSheetFacts(routeFacts);
    }
    setSheetOpen(true);
  }, [nodeByMesh, nodeId, title, profile, materialGrade, lengthMm, weightKg]);

  const onLoaded = useCallback((info: { matched: number }) => {
    if (meshNames && meshNames.length > 0 && info.matched === 0) setNotFound(true);
  }, [meshNames]);

  const dims: string[] = [];
  if (profile) dims.push(profile);
  if (materialGrade) dims.push(materialGrade);
  if (lengthMm) dims.push(`${Math.round(lengthMm)} mm`);
  if (weightKg) dims.push(`${(Math.round(weightKg * 10) / 10)} kg`);

  if (meshNames === null) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={Colors.white} />
        <Text style={styles.bootTxt}>Preparing 3D view…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PartWebViewer
        modelId={modelId}
        isolate={meshNames}
        highlight={highlight}
        onMeshClicked={onMeshClicked}
        onLoaded={onLoaded}
      />

      <View style={styles.info} pointerEvents="box-none">
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {dims.length > 0 && <Text style={styles.dims}>{dims.join('  ·  ')}</Text>}
        <Text style={styles.tapHint}>Tap a member to see its production status</Text>
        {notFound && <Text style={styles.warn}>Showing full model — this item's geometry wasn't found in the GLB.</Text>}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.arBtn}
          onPress={() =>
            navigation.navigate('ARView', {
              modelId,
              fileUrl,
              meshNames: meshNames && meshNames.length ? meshNames : undefined,
              partLabel: title,
            })
          }
        >
          <Ionicons name="cube-outline" size={20} color={Colors.white} />
          <Text style={styles.arTxt}>AR</Text>
        </TouchableOpacity>
      </View>

      <PieceStatusSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        nodeId={sheetNodeId}
        facts={sheetFacts}
        ancestorIds={ancestorIds}
        onOpenAssembly={(orderId, n, mark) =>
          navigation.navigate('AssemblyDetail', { orderId, projectId, nodeId: n, mark })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  boot: { flex: 1, backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center', gap: 12 },
  bootTxt: { color: '#c7c7e0', fontSize: 14 },
  info: { position: 'absolute', top: 12, left: 12, right: 12 },
  title: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  dims: { color: '#c7c7e0', fontSize: 13, marginTop: 2 },
  tapHint: { color: '#8ea8c8', fontSize: 12, marginTop: 4 },
  warn: { color: '#ffd180', fontSize: 12, marginTop: 6 },
  controls: { position: 'absolute', right: 16, bottom: 28, gap: 12 },
  arBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.tertiary, paddingHorizontal: 16, height: 44, borderRadius: 22, justifyContent: 'center' },
  arTxt: { color: Colors.white, fontWeight: '700' },
});
