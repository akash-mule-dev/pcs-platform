import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { environment } from '../../config/environment';

/**
 * Reusable three.js WebView model viewer — the mesh-pick + recolor ENABLER.
 *
 * Loads a project GLB once and then talks to the page imperatively (no reload):
 *  - WebView → RN: posts `meshClicked` with the tapped mesh name (== IFC GlobalId
 *    == assembly_nodes.ifc_guid) so the host can resolve the node.
 *  - RN → WebView: `highlight` emissive-highlights a set of mesh names and dims
 *    the rest (keeping context); `colors` paints meshes by a name→hex map.
 *
 * Isolation (showing only one node's descendant meshes) is still baked into the
 * page at build time via __ISO_SET__ — it rarely changes for a given mount.
 * Selection highlight/recolor are live injects so browsing parts never re-streams
 * the model (the static-isolation limitation the web viewer had on mobile).
 */
const VIEWER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;">
<style>
  * { margin: 0; padding: 0; }
  body { background: #eaf4fc; overflow: hidden; }
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
window._meshes = [];          // { mesh, baseColor, baseOpacity }
window._loaded = false;
var BASE_COLOR = 0x9aa2ad;
var HILITE = 0x1565c0;
var DIM_COLOR = 0xb8c0cc;

var scene = new THREE.Scene();
scene.background = new THREE.Color(0xeaf4fc);
function addSky(target) {
  var mat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x73b8ec) },
      horizonColor: { value: new THREE.Color(0xeaf4fc) },
      bottomColor: { value: new THREE.Color(0xe6ebf0) },
      exponent: { value: 0.7 }
    },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: 'varying vec3 vWorldPosition; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorldPosition = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 bottomColor; uniform float exponent; varying vec3 vWorldPosition; void main(){ float h = normalize(vWorldPosition).y; vec3 sky = mix(horizonColor, topColor, pow(max(h,0.0), exponent)); vec3 ground = mix(horizonColor, bottomColor, pow(max(-h,0.0), 0.45)); gl_FragColor = vec4(h >= 0.0 ? sky : ground, 1.0); }'
  });
  var dome = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), mat);
  dome.renderOrder = -1;
  target.add(dome);
}
addSky(scene);
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
var grid = new THREE.GridHelper(10, 20, 0xb9cbdc, 0xd9e5f0); scene.add(grid);

function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }
animate();
window.addEventListener('resize', function() {
  camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){} }

// ── Tap-to-pick (distinguished from an orbit drag) ──
var rayc = new THREE.Raycaster();
var down = null;
function namedAncestor(o){ var p = o; while (p) { if (p.name) return p.name; p = p.parent; } return null; }
function pick(cx, cy){
  var rect = renderer.domElement.getBoundingClientRect();
  var ndc = new THREE.Vector2(((cx-rect.left)/rect.width)*2-1, -((cy-rect.top)/rect.height)*2+1);
  rayc.setFromCamera(ndc, camera);
  var hits = rayc.intersectObjects(scene.children, true);
  for (var i = 0; i < hits.length; i++) {
    var o = hits[i].object;
    if (o && o.isMesh && o.visible && o.userData && o.userData.pickable) {
      post({ type: 'meshClicked', name: namedAncestor(o) });
      return;
    }
  }
  post({ type: 'meshClicked', name: null });
}
renderer.domElement.addEventListener('pointerdown', function(e){ down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
renderer.domElement.addEventListener('pointerup', function(e){
  if (!down) return;
  var dx = e.clientX - down.x, dy = e.clientY - down.y, dt = Date.now() - down.t;
  down = null;
  if (Math.sqrt(dx*dx + dy*dy) > 10 || dt > 500) return; // it was an orbit/drag
  pick(e.clientX, e.clientY);
});

// ── RN → page: highlight a set of mesh names (dim the rest) ──
window.setHighlight = function(json){
  var names; try { names = JSON.parse(json); } catch(e) { names = []; }
  var set = {}; for (var i = 0; i < names.length; i++) set[names[i]] = true;
  var has = names.length > 0;
  window._meshes.forEach(function(it){
    var m = it.mesh, on = false;
    if (has) { var p = m; while (p) { if (set[p.name]) { on = true; break; } p = p.parent; } }
    var mat = m.material; if (!mat) return;
    mat.emissive && mat.emissive.setHex(on ? HILITE : 0x000000);
    if ('emissiveIntensity' in mat) mat.emissiveIntensity = on ? 0.4 : 0;
    mat.color.setHex(it.baseColor);
    if (!has || on) { mat.opacity = it.baseOpacity; mat.transparent = it.baseOpacity < 1; }
    else { mat.opacity = 0.12; mat.transparent = true; }
    mat.needsUpdate = true;
  });
};

// ── RN → page: paint meshes by a name→hex map (status / readiness overlay) ──
window.setColors = function(json){
  var map; try { map = JSON.parse(json); } catch(e) { map = {}; }
  var any = false; for (var k in map) { any = true; break; }
  window._meshes.forEach(function(it){
    var m = it.mesh, color = null, p = m;
    while (p) { if (map[p.name] != null) { color = map[p.name]; break; } p = p.parent; }
    var mat = m.material; if (!mat) return;
    mat.emissive && mat.emissive.setHex(0x000000);
    if ('emissiveIntensity' in mat) mat.emissiveIntensity = 0;
    if (color != null) { mat.color.setHex(color); mat.opacity = it.baseOpacity; mat.transparent = it.baseOpacity < 1; }
    else if (any) { mat.color.setHex(DIM_COLOR); mat.opacity = 0.16; mat.transparent = true; }
    else { mat.color.setHex(it.baseColor); mat.opacity = it.baseOpacity; mat.transparent = it.baseOpacity < 1; }
    mat.needsUpdate = true;
  });
};

window.loadModelFromBase64 = function(b64) {
  document.getElementById('pct').textContent = 'Parsing…';
  document.getElementById('fill').style.width = '85%';
  try {
    var bin = atob(b64); var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    new GLTFLoader().parse(bytes.buffer, '', function(gltf) {
      var model = gltf.scene;
      // IFC-converted GLBs carry no vertex normals and no materials — give every
      // mesh computed normals + a lit steel material so it renders, and record it
      // for pick/highlight/recolor.
      model.traverse(function(o) {
        if (!o.isMesh) return;
        if (o.geometry && !(o.geometry.attributes && o.geometry.attributes.normal)) o.geometry.computeVertexNormals();
        o.material = new THREE.MeshStandardMaterial({ color: BASE_COLOR, metalness: 0.2, roughness: 0.75, side: THREE.DoubleSide });
        o.userData.pickable = true;
        window._meshes.push({ mesh: o, baseColor: BASE_COLOR, baseOpacity: 1 });
      });
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
      model.updateMatrixWorld(true);
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
      window._loaded = true;
      post({ type: 'loaded', matched: matched, dims: { x: size.x, y: size.y, z: size.z } });
    }, function(err) { document.getElementById('loading').innerHTML = '<div id="err">Parse error: ' + (err.message || err) + '</div>'; });
  } catch (e) { document.getElementById('loading').innerHTML = '<div id="err">Error: ' + e.message + '</div>'; }
};
post({ type: 'ready' });
</script>
</body>
</html>`;

export interface PartWebViewerProps {
  modelId: string;
  /** Mesh names to show (others hidden). null/empty = show the whole model. */
  isolate?: string[] | null;
  /** Mesh names to emissive-highlight (others dimmed but visible). */
  highlight?: string[];
  /** name → hex color map to paint the model (status/readiness overlay). */
  colors?: Record<string, number> | null;
  onMeshClicked?: (name: string | null) => void;
  onLoaded?: (info: { matched: number; dims: { x: number; y: number; z: number } }) => void;
  style?: ViewStyle;
}

export function PartWebViewer({
  modelId,
  isolate,
  highlight,
  colors,
  onMeshClicked,
  onLoaded,
  style,
}: PartWebViewerProps) {
  const webRef = useRef<WebView>(null);
  const [fetching, setFetching] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fileUrl = `${environment.apiUrl}/models/${modelId}/file`;

  // Isolation set is baked into the page (rarely changes for a mount).
  const html = useMemo(
    () => VIEWER_HTML.replace('__ISO_SET__', JSON.stringify(isolate ?? [])),
    [isolate],
  );

  // A fresh mount/model means the page reloads — reset the loaded gate.
  useEffect(() => { setLoaded(false); }, [html, modelId]);

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

  // Apply the active paint after load (and whenever it changes). A non-empty
  // `colors` map (status/readiness overlay) takes precedence; otherwise the
  // `highlight` selection is shown. The two are mutually exclusive so they never
  // fight over the same materials.
  useEffect(() => {
    if (!loaded) return;
    const hasColors = !!colors && Object.keys(colors).length > 0;
    if (hasColors) {
      webRef.current?.injectJavaScript(`window.setColors && window.setColors(${JSON.stringify(JSON.stringify(colors))});true;`);
    } else {
      webRef.current?.injectJavaScript(`window.setHighlight && window.setHighlight(${JSON.stringify(JSON.stringify(highlight ?? []))});true;`);
    }
  }, [loaded, highlight, colors]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') sendModel();
      else if (msg.type === 'loaded') { setLoaded(true); onLoaded?.({ matched: msg.matched, dims: msg.dims }); }
      else if (msg.type === 'meshClicked') onMeshClicked?.(msg.name ?? null);
    } catch {}
  }, [sendModel, onLoaded, onMeshClicked]);

  return (
    <View style={[styles.container, style]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  webview: { flex: 1, backgroundColor: '#1a1a2e' },
});
