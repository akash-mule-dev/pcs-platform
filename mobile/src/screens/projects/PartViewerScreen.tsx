import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Colors } from '../../theme/colors';
import { environment } from '../../config/environment';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService } from '../../services/projects.service';

type Rt = RouteProp<ProjectsStackParamList, 'PartViewer'>;

// three.js WebView viewer. Loads the project GLB and isolates the meshes that
// belong to this node — for a part that's just its own mesh; for an assembly
// it's every descendant part (the container itself has no geometry). The set of
// mesh names (== IFC GlobalIds) is baked into the page as __ISO_SET__.
const VIEWER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;">
<style>
  * { margin: 0; padding: 0; }
  body { background: #1a1a2e; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; touch-action: none; }
  #loading { position: fixed; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; background: rgba(26,26,46,0.95); color: #fff; font-family: sans-serif; }
  #bar { width: 60%; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; margin-top: 12px; }
  #fill { height: 100%; background: #1565c0; border-radius: 3px; width: 0%; transition: width 0.2s; }
  #err { color: #ff8a80; word-break: break-all; padding: 20px; }
</style>
</head>
<body>
<div id="loading"><div id="pct">Initializing 3D…</div><div id="bar"><div id="fill"></div></div></div>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

window._iso = __ISO_SET__;

var scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
var camera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 0.01, 1000);
camera.position.set(2.4, 1.8, 2.8);
var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);
var controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
var dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(5, 10, 7); scene.add(dir);
var dir2 = new THREE.DirectionalLight(0xffffff, 0.3); dir2.position.set(-5, 2, -5); scene.add(dir2);
var grid = new THREE.GridHelper(10, 20, 0x39395a, 0x2a2a44); scene.add(grid);

function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }
animate();
window.addEventListener('resize', function() {
  camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){} }

window.loadModelFromBase64 = function(b64) {
  document.getElementById('pct').textContent = 'Parsing…';
  document.getElementById('fill').style.width = '85%';
  try {
    var bin = atob(b64); var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    new GLTFLoader().parse(bytes.buffer, '', function(gltf) {
      var model = gltf.scene;
      var iso = window._iso; var matched = 0;
      if (Array.isArray(iso) && iso.length) {
        var set = {};
        for (var k = 0; k < iso.length; k++) set[iso[k]] = true;
        model.traverse(function(o) {
          if (o.isMesh) {
            var keep = false, p = o;
            while (p) { if (set[p.name]) { keep = true; break; } p = p.parent; }
            o.visible = keep; if (keep) matched++;
          }
        });
      }
      var box = new THREE.Box3(), tmp = new THREE.Box3(), any = false;
      model.traverse(function(o) { if (o.isMesh && o.visible) { tmp.setFromObject(o); if (!tmp.isEmpty()) { box.union(tmp); any = true; } } });
      if (!any) { box.setFromObject(model); }
      var center = box.getCenter(new THREE.Vector3());
      var size = box.getSize(new THREE.Vector3());
      var maxDim = Math.max(size.x, size.y, size.z) || 1;
      var s = 2 / maxDim;
      model.scale.setScalar(s);
      model.position.sub(center.multiplyScalar(s));
      scene.add(model);
      controls.target.set(0, 0, 0);
      camera.position.set(2.4, 1.8, 2.8); controls.update();
      document.getElementById('loading').style.display = 'none';
      post({ type: 'loaded', matched: matched, dims: { x: size.x, y: size.y, z: size.z } });
    }, function(err) { document.getElementById('loading').innerHTML = '<div id="err">Parse error: ' + (err.message || err) + '</div>'; });
  } catch (e) { document.getElementById('loading').innerHTML = '<div id="err">Error: ' + e.message + '</div>'; }
};
post({ type: 'ready' });
</script>
</body>
</html>`;

export function PartViewerScreen() {
  const route = useRoute<Rt>();
  const navigation = useNavigation<any>();
  const { projectId, nodeId, modelId, title, profile, materialGrade, lengthMm, weightKg } = route.params;
  const webRef = useRef<WebView>(null);
  const [fetching, setFetching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // null = still resolving which meshes to isolate; [] = no isolation (show all).
  const [meshNames, setMeshNames] = useState<string[] | null>(null);

  const fileUrl = `${environment.apiUrl}/models/${modelId}/file`;

  useEffect(() => {
    let alive = true;
    projectsService
      .getNodeMeshes(projectId, nodeId)
      .then((names) => { if (alive) setMeshNames(names || []); })
      .catch(() => { if (alive) setMeshNames([]); });
    return () => { alive = false; };
  }, [projectId, nodeId]);

  const html = useMemo(
    () => VIEWER_HTML.replace('__ISO_SET__', JSON.stringify(meshNames ?? [])),
    [meshNames],
  );

  const sendModel = useCallback(async () => {
    if (fetching) return;
    setFetching(true);
    try {
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const base64: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      const CHUNK = 512 * 1024;
      const total = Math.ceil(base64.length / CHUNK);
      webRef.current?.injectJavaScript(`window._c=[];window._t=${total};true;`);
      for (let i = 0; i < total; i++) {
        const chunk = base64.substring(i * CHUNK, (i + 1) * CHUNK);
        const pct = Math.round(((i + 1) / total) * 70);
        webRef.current?.injectJavaScript(`
          window._c.push("${chunk}");
          document.getElementById('pct').textContent='Downloading… ${pct}%';
          document.getElementById('fill').style.width='${pct}%';
          if (window._c.length===window._t) window.loadModelFromBase64(window._c.join(''));
          true;`);
      }
    } catch (err: any) {
      webRef.current?.injectJavaScript(`document.getElementById('loading').innerHTML='<div id="err">Fetch error: ${String(err.message).replace(/'/g, "\\'")}</div>';true;`);
    }
    setFetching(false);
  }, [fileUrl, fetching]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') sendModel();
      else if (msg.type === 'loaded' && meshNames && meshNames.length > 0 && msg.matched === 0) setNotFound(true);
    } catch {}
  }, [sendModel, meshNames]);

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
      <WebView
        ref={webRef}
        style={styles.webview}
        originWhitelist={['*']}
        source={{ html }}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        onMessage={onMessage}
        onLoadEnd={() => setTimeout(() => sendModel(), 1500)}
      />
      <View style={styles.info} pointerEvents="box-none">
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {dims.length > 0 && <Text style={styles.dims}>{dims.join('  ·  ')}</Text>}
        {notFound && <Text style={styles.warn}>Showing full model — this item's geometry wasn't found in the GLB.</Text>}
      </View>
      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.arBtn}
          onPress={() =>
            navigation.getParent()?.navigate('Models', {
              screen: 'ARView',
              params: { modelId, fileUrl, meshNames: meshNames && meshNames.length ? meshNames : undefined, partLabel: title },
            })
          }
        >
          <Ionicons name="cube-outline" size={20} color={Colors.white} />
          <Text style={styles.arTxt}>AR</Text>
        </TouchableOpacity>
      </View>
      {fetching && (
        <View style={styles.spin} pointerEvents="none"><ActivityIndicator color={Colors.white} /></View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  webview: { flex: 1, backgroundColor: '#1a1a2e' },
  boot: { flex: 1, backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center', gap: 12 },
  bootTxt: { color: '#c7c7e0', fontSize: 14 },
  info: { position: 'absolute', top: 12, left: 12, right: 12 },
  title: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  dims: { color: '#c7c7e0', fontSize: 13, marginTop: 2 },
  warn: { color: '#ffd180', fontSize: 12, marginTop: 6 },
  controls: { position: 'absolute', right: 16, bottom: 28, gap: 12 },
  arBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.tertiary, paddingHorizontal: 16, height: 44, borderRadius: 22, justifyContent: 'center' },
  arTxt: { color: Colors.white, fontWeight: '700' },
  spin: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
