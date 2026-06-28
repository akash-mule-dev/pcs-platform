import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { environment } from '../../config/environment';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService, MNode } from '../../services/projects.service';
import { PartWebViewer, ViewerRenderMode, ViewerCameraPreset } from './PartWebViewer';
import { PieceStatusSheet, PieceFacts } from './PieceStatusSheet';
import ViewerToolBar, { ViewerTab } from './partviewer/ViewerToolBar';
import ViewPanel from './partviewer/ViewPanel';
import ColorPanel from './partviewer/ColorPanel';
import MeasurePanel from './partviewer/MeasurePanel';
import { ColorBy, buildColorBy, referenceLengthsFrom } from './partviewer/viewerTools';

type Rt = RouteProp<ProjectsStackParamList, 'PartViewer'>;

/**
 * 3D viewer for one assembly/part. Isolates the node's descendant meshes and
 * gives the user a tabbed inspection bar (mirroring the AR viewer):
 *   • View    — camera presets + solid/wireframe render mode
 *   • Color   — paint by profile / grade (with a legend)
 *   • Measure — point-to-point distance + bounding-box dimensions, in real mm
 * Tapping a member (when not measuring) opens its live production-status card —
 * the spatial twin of the QR-scan resolve flow.
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

  // ── Tool state ──
  const [tab, setTab] = useState<ViewerTab | null>(null);
  // Default the 3D viewer to colour-by-PROFILE so members read by section on open
  // (the model recolours once the node data loads); switch to Grade/None in the panel.
  const [colorBy, setColorBy] = useState<ColorBy>('profile');
  const [renderMode, setRenderMode] = useState<ViewerRenderMode>('solid');
  const [distanceOn, setDistanceOn] = useState(false);
  const [dimensionsOn, setDimensionsOn] = useState(false);
  const [distance, setDistance] = useState<{ mm: number | null; calibrated: boolean } | null>(null);
  const [dims, setDims] = useState<{ l: number; h: number; d: number; calibrated: boolean } | null>(null);
  const [mmPerWorld, setMmPerWorld] = useState<number | null>(null);
  const [camera, setCamera] = useState<{ preset: ViewerCameraPreset; nonce: number } | null>(null);
  const [clearNonce, setClearNonce] = useState(0);

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

  // ── Tool derivations ──
  const referenceLengths = useMemo(() => referenceLengthsFrom(nodes), [nodes]);
  const colorByResult = useMemo(() => buildColorBy(nodes, colorBy, meshNames), [nodes, colorBy, meshNames]);
  const calibrated = mmPerWorld != null ? isFinite(mmPerWorld) : referenceLengths.length > 0;
  const measuring = distanceOn;

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

  // Mutually-exclusive panel toggle (tap the open tab to close it).
  const selectTab = useCallback((t: ViewerTab) => setTab((cur) => (cur === t ? null : t)), []);

  const onPreset = useCallback((preset: ViewerCameraPreset) => {
    setCamera((c) => ({ preset, nonce: (c?.nonce ?? 0) + 1 }));
  }, []);
  const onClear = useCallback(() => { setClearNonce((n) => n + 1); setDistance(null); }, []);

  const dims2: string[] = [];
  if (profile) dims2.push(profile);
  if (materialGrade) dims2.push(materialGrade);
  if (lengthMm) dims2.push(`${Math.round(lengthMm)} mm`);
  if (weightKg) dims2.push(`${(Math.round(weightKg * 10) / 10)} kg`);

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
        highlight={measuring ? [] : highlight}
        colors={colorBy !== 'none' ? colorByResult.colors : null}
        referenceLengths={referenceLengths}
        measureMode={distanceOn ? 'distance' : 'none'}
        showDimensions={dimensionsOn}
        renderMode={renderMode}
        cameraCommand={camera}
        clearNonce={clearNonce}
        onMeshClicked={onMeshClicked}
        onLoaded={onLoaded}
        onMeasure={setDistance}
        onDimensions={setDims}
        onCalibrated={setMmPerWorld}
      />

      <View style={styles.info} pointerEvents="box-none">
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {dims2.length > 0 && <Text style={styles.dims}>{dims2.join('  ·  ')}</Text>}
        <Text style={styles.tapHint}>
          {measuring ? 'Tap two points to measure' : 'Tap a member to see its production status'}
        </Text>
        {notFound && <Text style={styles.warn}>Showing full model — this item's geometry wasn't found in the GLB.</Text>}
      </View>

      {/* AR shortcut (top-right, clear of the bottom tool bar). */}
      <TouchableOpacity
        style={styles.arBtn}
        onPress={() =>
          navigation.navigate('ARView', {
            modelId,
            fileUrl,
            meshNames: meshNames && meshNames.length ? meshNames : undefined,
            partLabel: title,
            // Carries the project so AR can colour-by Profile / Grade (needs node data).
            projectId,
          })
        }
      >
        <Ionicons name="scan-outline" size={18} color={Colors.white} />
        <Text style={styles.arTxt}>AR</Text>
      </TouchableOpacity>

      {/* ── Docked tool panel (above the tabs) ── */}
      {tab === 'view' && (
        <ViewPanel renderMode={renderMode} onPreset={onPreset} onRenderMode={setRenderMode} />
      )}
      {tab === 'color' && (
        <ColorPanel colorBy={colorBy} legend={colorByResult.legend} onColorBy={setColorBy} />
      )}
      {tab === 'measure' && (
        <MeasurePanel
          distanceOn={distanceOn}
          dimensionsOn={dimensionsOn}
          distance={distance}
          dims={dims}
          calibrated={calibrated}
          onToggleDistance={() => setDistanceOn((v) => !v)}
          onToggleDimensions={() => setDimensionsOn((v) => !v)}
          onClear={onClear}
        />
      )}

      <ViewerToolBar active={tab} onSelect={selectTab} />

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
  info: { position: 'absolute', top: 12, left: 12, right: 70 },
  title: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  dims: { color: '#c7c7e0', fontSize: 13, marginTop: 2 },
  tapHint: { color: '#8ea8c8', fontSize: 12, marginTop: 4 },
  warn: { color: '#ffd180', fontSize: 12, marginTop: 6 },
  arBtn: {
    position: 'absolute', top: 10, right: 14, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.tertiary, paddingHorizontal: 14, height: 40, borderRadius: 20, justifyContent: 'center',
  },
  arTxt: { color: Colors.white, fontWeight: '700' },
});
