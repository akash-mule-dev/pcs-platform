import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { modelCache } from '../../services/modelCache';

/**
 * Reusable three.js WebView model viewer — the mesh-pick + recolor ENABLER and
 * the engine behind the dedicated 3D Viewer screen's measure / colour / view
 * tools.
 *
 * Loads a project GLB once and then talks to the page imperatively (no reload):
 *  - WebView → RN: posts `meshClicked` (tapped mesh name == IFC GlobalId ==
 *    assembly_nodes.ifc_guid), `measure` (live ruler readout) and `dims`
 *    (bounding-box L×W×H) so the host can drive its UI.
 *  - RN → WebView: `highlight` emissive-highlights a set of mesh names and dims
 *    the rest; `colors` paints meshes by a name→hex map; the opt-in tool props
 *    (`measureMode`, `showDimensions`, `renderMode`, `cameraCommand`,
 *    `referenceLengths`, `clearNonce`) drive the inspection tools.
 *
 * Real-world units: GLBs are auto-fit-scaled, so a world unit has no fixed size.
 * `referenceLengths` (a part's known `length_mm` vs its longest world edge,
 * median over clearly-linear members) calibrates mm-per-world-unit so measure +
 * dimensions read in real millimetres — the same approach as the web viewer.
 *
 * Isolation (showing only one node's descendant meshes) is baked into the page
 * at build time via __ISO_SET__ — it rarely changes for a given mount.
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
  /* Crisp DOM measurement labels (CSS2D) — never intercept touches. */
  #labels { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
  .lab { padding: 3px 7px; border-radius: 6px; background: rgba(15,23,42,0.92); color: #fff;
         font: 700 13px -apple-system, sans-serif; white-space: nowrap; border: 1px solid rgba(255,255,255,0.28);
         box-shadow: 0 1px 4px rgba(0,0,0,0.45); transform: translate(-50%,-50%); }
  .lab.dim { background: rgba(2,90,140,0.92); }
</style>
</head>
<body>
<div id="loading"><div id="pct">Initializing 3D…</div><div id="bar"><div id="fill"></div></div></div>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

window._iso = __ISO_SET__;
window._meshes = [];          // { mesh, baseColor, baseOpacity }
window._loaded = false;
window._modelScale = 1;       // uniform autofit scale applied to the model root
window._mmPerWorld = NaN;     // calibration: real mm per world unit (NaN = uncalibrated)
window._measureMode = 'none'; // 'none' | 'distance'
window._measurePts = [];      // THREE.Vector3[] for the in-progress ruler
window._dimsOn = false;
window._loading = false;      // re-entry guard for loadModelFromBase64
window._fitDist = 4;          // camera distance that frames the model
window._camAnim = null;       // active camera fly-to (focus-on-selection)
var BASE_COLOR = 0x9aa2ad;
var HILITE = 0x1565c0;
var DIM_COLOR = 0xb8c0cc;
var MEASURE_COLOR = 0x22d3ee;

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

// CSS2D label layer for crisp measurement text (DOM, never blurred).
var labelEl = document.createElement('div'); labelEl.id = 'labels'; document.body.appendChild(labelEl);
var labelRenderer = new CSS2DRenderer({ element: labelEl });
labelRenderer.setSize(window.innerWidth, window.innerHeight);

var controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
var dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(5, 10, 7); scene.add(dir);
var dir2 = new THREE.DirectionalLight(0xffffff, 0.3); dir2.position.set(-5, 2, -5); scene.add(dir2);
var grid = new THREE.GridHelper(10, 20, 0xb9cbdc, 0xd9e5f0); scene.add(grid);

// World-space groups for measurement visuals (no model transform).
var measureGroup = new THREE.Group(); scene.add(measureGroup);
var dimGroup = new THREE.Group(); scene.add(dimGroup);

function animate() {
  requestAnimationFrame(animate);
  // Camera fly-to (focus-on-selection): lerp position + target over the duration.
  if (window._camAnim) {
    var a = window._camAnim;
    var t = Math.min(1, (performance.now() - a.start) / a.duration);
    var e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOutQuad
    camera.position.lerpVectors(a.fromPos, a.toPos, e);
    controls.target.lerpVectors(a.fromTgt, a.toTgt, e);
    if (t >= 1) { window._camAnim = null; controls.enableDamping = true; } // restore free-orbit damping
  }
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
window.addEventListener('resize', function() {
  camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){} }

// world units → real mm → human string ('—' when uncalibrated).
function fmt(worldDist){
  var mm = worldDist * window._mmPerWorld;
  if (!isFinite(mm)) return '—';
  if (mm >= 1000) return (mm/1000).toFixed(mm >= 10000 ? 1 : 2) + ' m';
  return Math.round(mm) + ' mm';
}
function makeLabel(text, cls){
  var d = document.createElement('div');
  d.className = 'lab' + (cls ? ' ' + cls : '');
  d.textContent = text;
  return new CSS2DObject(d);
}
function clearGroup(g){
  while (g.children.length) {
    var c = g.children.pop();
    if (c.element && c.element.parentNode) c.element.parentNode.removeChild(c.element);
    if (c.geometry) c.geometry.dispose();
    g.remove(c);
  }
}

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
      if (window._measureMode === 'distance') { addMeasurePoint(hits[i].point); return; }
      post({ type: 'meshClicked', name: namedAncestor(o) });
      return;
    }
  }
  if (window._measureMode !== 'distance') post({ type: 'meshClicked', name: null });
}
renderer.domElement.addEventListener('pointerdown', function(e){ down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
renderer.domElement.addEventListener('pointerup', function(e){
  if (!down) return;
  var dx = e.clientX - down.x, dy = e.clientY - down.y, dt = Date.now() - down.t;
  down = null;
  if (Math.sqrt(dx*dx + dy*dy) > 10 || dt > 500) return; // it was an orbit/drag
  pick(e.clientX, e.clientY);
});

// ── Distance ruler ──
function addMeasurePoint(pt){
  if (window._measurePts.length >= 2) clearMeasure(true); // third tap starts a fresh measurement
  window._measurePts.push(pt.clone());
  var sph = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), new THREE.MeshBasicMaterial({ color: MEASURE_COLOR }));
  sph.position.copy(pt); measureGroup.add(sph);
  if (window._measurePts.length === 2) {
    var a = window._measurePts[0], b = window._measurePts[1];
    var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: MEASURE_COLOR }));
    measureGroup.add(line);
    var d = a.distanceTo(b);
    var L = makeLabel(fmt(d));
    L.position.set((a.x+b.x)/2, (a.y+b.y)/2, (a.z+b.z)/2);
    measureGroup.add(L);
    post({ type: 'measure', mm: isFinite(d * window._mmPerWorld) ? d * window._mmPerWorld : null, calibrated: isFinite(window._mmPerWorld) });
  } else {
    post({ type: 'measure', mm: null, calibrated: isFinite(window._mmPerWorld) });
  }
}
function clearMeasure(silent){
  clearGroup(measureGroup);
  window._measurePts = [];
  if (!silent) post({ type: 'measure', mm: null, calibrated: isFinite(window._mmPerWorld) });
}
window.clearMeasure = function(){ clearMeasure(false); };
window.setMeasureMode = function(mode){
  window._measureMode = mode || 'none';
  if (window._measurePts.length === 1) clearMeasure(true); // drop a dangling single point
};

// ── Bounding-box dimensions (L×W×H) ──
function visibleBox(){
  var box = new THREE.Box3(), tmp = new THREE.Box3(), any = false;
  window._meshes.forEach(function(it){ if (it.mesh.visible) { tmp.setFromObject(it.mesh); if (!tmp.isEmpty()) { box.union(tmp); any = true; } } });
  return any ? box : null;
}
window.showDims = function(on){
  window._dimsOn = !!on;
  clearGroup(dimGroup);
  if (!on) return;
  var box = visibleBox();
  if (!box) return;
  var size = box.getSize(new THREE.Vector3());
  var min = box.min, max = box.max, c = box.getCenter(new THREE.Vector3());
  var helper = new THREE.Box3Helper(box, 0x38bdf8); dimGroup.add(helper);
  function lab(prefix, world, pos){ var L = makeLabel(prefix + ' ' + fmt(world), 'dim'); L.position.copy(pos); dimGroup.add(L); }
  lab('L', size.x, new THREE.Vector3(c.x, min.y, max.z)); // width  (X) — bottom front edge
  lab('H', size.y, new THREE.Vector3(max.x, c.y, max.z)); // height (Y) — right  front edge
  lab('D', size.z, new THREE.Vector3(max.x, min.y, c.z)); // depth  (Z) — bottom right  edge
  post({ type: 'dims', l: size.x * window._mmPerWorld, h: size.y * window._mmPerWorld, d: size.z * window._mmPerWorld, calibrated: isFinite(window._mmPerWorld) });
};

// ── Render mode (solid / wireframe) ──
window.setRenderMode = function(mode){
  var wire = mode === 'wireframe';
  window._meshes.forEach(function(it){ if (it.mesh.material) { it.mesh.material.wireframe = wire; it.mesh.material.needsUpdate = true; } });
};

// ── Camera presets ──
window.setCamera = function(p){
  var d = window._fitDist || 4;
  if (p === 'reset') controls.target.set(0, 0, 0);
  var t = controls.target;
  var dir;
  if (p === 'front') dir = new THREE.Vector3(0, 0, 1);
  else if (p === 'top') dir = new THREE.Vector3(0.0001, 1, 0.0001);
  else if (p === 'side') dir = new THREE.Vector3(1, 0, 0);
  else dir = new THREE.Vector3(0.8, 0.6, 0.95).normalize(); // iso / reset / default
  camera.up.set(0, 1, 0);
  camera.position.copy(t.clone().add(dir.multiplyScalar(d)));
  controls.update();
};

// ── Focus-on-selection: frame a set of mesh names, keeping the view direction ──
// so the user never loses orientation (mirrors the web viewer's autoFocus).
window.focusOn = function(json){
  var names; try { names = JSON.parse(json); } catch(e) { return; }
  if (!Array.isArray(names) || !names.length || !window._meshes.length) return;
  var set = {}; for (var i = 0; i < names.length; i++) set[names[i]] = true;
  var box = new THREE.Box3(), tmp = new THREE.Box3(), found = false;
  window._meshes.forEach(function(it){
    var m = it.mesh, on = false, p = m;
    while (p) { if (set[p.name]) { on = true; break; } p = p.parent; }
    if (on && m.visible) { tmp.setFromObject(m); if (!tmp.isEmpty()) { box.union(tmp); found = true; } }
  });
  if (!found || box.isEmpty()) return;
  var sphere = box.getBoundingSphere(new THREE.Sphere());
  var radius = Math.max(sphere.radius, 0.01);
  var vFov = camera.fov * Math.PI / 180;
  var hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  var fitDist = radius / Math.sin(Math.min(vFov, hFov) / 2) * 1.15;
  var dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(3, 2, 5);
  dir.normalize();
  controls.enableDamping = false; // avoid leftover orbit momentum fighting the fly-to
  window._camAnim = {
    fromPos: camera.position.clone(),
    toPos: sphere.center.clone().add(dir.multiplyScalar(fitDist)),
    fromTgt: controls.target.clone(),
    toTgt: sphere.center.clone(),
    start: performance.now(),
    duration: 600,
  };
};

// ── Calibration: derive mm-per-world-unit from known part lengths ──
// For each clearly-linear member with a known length_mm, ratio = length_mm /
// its longest world-space edge; the median is robust to outliers.
window.setReferenceLengths = function(json){
  var refs; try { refs = JSON.parse(json); } catch(e) { refs = []; }
  // Always report the OUTCOME (success or failure) so the host can distinguish
  // "calibrated" from "no usable reference" and show the right warning.
  if (!Array.isArray(refs) || !refs.length) { window._mmPerWorld = NaN; post({ type: 'calibrated', mmPerWorld: window._mmPerWorld }); return; }
  var byName = {}; refs.forEach(function(r){ if (r && r.name) byName[r.name] = r.lengthMm; });
  var ratios = [];
  var ws = new THREE.Vector3();
  window._meshes.forEach(function(it){
    var m = it.mesh, len = null, p = m;
    while (p) { if (byName[p.name] != null) { len = byName[p.name]; break; } p = p.parent; }
    if (!len || len <= 0) return;
    var g = m.geometry; if (!g) return; if (!g.boundingBox) g.computeBoundingBox();
    var sz = new THREE.Vector3(); g.boundingBox.getSize(sz);
    m.getWorldScale(ws);
    var dims = [sz.x * Math.abs(ws.x), sz.y * Math.abs(ws.y), sz.z * Math.abs(ws.z)].sort(function(a, b){ return a - b; });
    var longest = dims[2], mid = dims[1];
    if (longest <= 0) return;
    if (mid > 0 && longest / mid < 3) return; // only trust clearly-linear members
    ratios.push(len / longest);               // mm per world unit
  });
  if (!ratios.length) { window._mmPerWorld = NaN; post({ type: 'calibrated', mmPerWorld: window._mmPerWorld }); return; }
  ratios.sort(function(a, b){ return a - b; });
  window._mmPerWorld = ratios[Math.floor(ratios.length / 2)];
  post({ type: 'calibrated', mmPerWorld: window._mmPerWorld });
};

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
  // Re-entry guard: the page is told to load via both the ready message and an
  // onLoadEnd timeout fallback, so a fast download could otherwise parse twice —
  // duplicating meshes (corrupting highlight/colour/calibration) and geometry.
  if (window._loaded || window._loading) return;
  window._loading = true;
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
      window._modelScale = s;
      model.scale.setScalar(s);
      model.position.sub(center.multiplyScalar(s));
      scene.add(model);
      model.updateMatrixWorld(true);
      // Frame the model: distance that fits its bounding sphere in the FOV.
      var sphereR = size.length() / 2 * s;
      window._fitDist = sphereR / Math.sin((55 * Math.PI / 180) / 2) * 1.1 || 4;
      controls.target.set(0, 0, 0);
      window.setCamera('iso');
      document.getElementById('loading').style.display = 'none';
      window._loaded = true;
      window._loading = false;
      post({ type: 'loaded', matched: matched, dims: { x: size.x, y: size.y, z: size.z } });
    }, function(err) { window._loading = false; document.getElementById('loading').innerHTML = '<div id="err">Parse error: ' + (err.message || err) + '</div>'; });
  } catch (e) { window._loading = false; document.getElementById('loading').innerHTML = '<div id="err">Error: ' + e.message + '</div>'; }
};
post({ type: 'ready' });
</script>
</body>
</html>`;

export type ViewerRenderMode = 'solid' | 'wireframe';
export type ViewerCameraPreset = 'reset' | 'iso' | 'front' | 'top' | 'side';

export interface ViewerReferenceLength {
  /** Mesh / node name (== ifc_guid) carrying a known real length. */
  name: string;
  /** That member's real length in millimetres. */
  lengthMm: number;
}

export interface PartWebViewerProps {
  modelId: string;
  /** Mesh names to show (others hidden). null/empty = show the whole model. */
  isolate?: string[] | null;
  /** Mesh names to emissive-highlight (others dimmed but visible). */
  highlight?: string[];
  /** When true, animate the camera to frame the highlighted meshes. */
  autoFocus?: boolean;
  /** Bump on every selection (even re-selecting the same part) to re-fire the focus zoom. */
  focusNonce?: number;
  /** name → hex color map to paint the model (status/readiness overlay). */
  colors?: Record<string, number> | null;
  // ── Opt-in inspection tools (3D Viewer screen). Omitted → unchanged embeds. ──
  /** Known part lengths used to calibrate mm-per-world-unit for measurements. */
  referenceLengths?: ViewerReferenceLength[];
  /** 'distance' makes taps place ruler points (instead of picking a member). */
  measureMode?: 'none' | 'distance';
  /** Show the bounding-box L×H×D dimension overlay. */
  showDimensions?: boolean;
  /** Solid or wireframe rendering. */
  renderMode?: ViewerRenderMode;
  /** One-shot camera move — bump `nonce` to re-fire the same preset. */
  cameraCommand?: { preset: ViewerCameraPreset; nonce: number } | null;
  /** Bump to clear the active ruler. */
  clearNonce?: number;
  onMeshClicked?: (name: string | null) => void;
  onLoaded?: (info: { matched: number; dims: { x: number; y: number; z: number } }) => void;
  /** Live ruler readout (mm null until two points are placed / uncalibrated). */
  onMeasure?: (r: { mm: number | null; calibrated: boolean }) => void;
  /** Bounding-box dimensions in mm (null components when uncalibrated). */
  onDimensions?: (r: { l: number; h: number; d: number; calibrated: boolean }) => void;
  /** Fires once the mm-per-world-unit calibration is resolved (NaN = failed). */
  onCalibrated?: (mmPerWorld: number) => void;
  style?: ViewStyle;
}

export function PartWebViewer({
  modelId,
  isolate,
  highlight,
  autoFocus = false,
  focusNonce,
  colors,
  referenceLengths,
  measureMode = 'none',
  showDimensions = false,
  renderMode = 'solid',
  cameraCommand,
  clearNonce,
  onMeshClicked,
  onLoaded,
  onMeasure,
  onDimensions,
  onCalibrated,
  style,
}: PartWebViewerProps) {
  const webRef = useRef<WebView>(null);
  const [fetching, setFetching] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
      // From the persistent on-device cache (downloaded once at login or first
      // view) — no network on a cache hit, and it works offline.
      const base64 = await modelCache.getBase64(modelId, (pct) => {
        webRef.current?.injectJavaScript(
          `var p=document.getElementById('pct'); if(p)p.textContent='Downloading… ${pct}%';` +
          `var f=document.getElementById('fill'); if(f)f.style.width='${Math.round(pct * 0.4)}%'; true;`,
        );
      });
      const CHUNK = 512 * 1024;
      const total = Math.ceil(base64.length / CHUNK);
      webRef.current?.injectJavaScript(`window._c=[];window._t=${total};true;`);
      for (let i = 0; i < total; i++) {
        const chunk = base64.substring(i * CHUNK, (i + 1) * CHUNK);
        const pct = 40 + Math.round(((i + 1) / total) * 55);
        webRef.current?.injectJavaScript(`
          window._c.push("${chunk}");
          document.getElementById('pct').textContent='Loading… ${pct}%';
          document.getElementById('fill').style.width='${pct}%';
          if (window._c.length===window._t) window.loadModelFromBase64(window._c.join(''));
          true;`);
      }
    } catch (err: any) {
      webRef.current?.injectJavaScript(`document.getElementById('loading').innerHTML='<div id="err">Load error: ${String(err.message).replace(/'/g, "\\'")}</div>';true;`);
    }
    setFetching(false);
  }, [modelId, fetching]);

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

  // Calibration + view-state (render mode, dimensions). Re-injected together so
  // calibration always runs before the dimensions are (re)drawn in mm. Measure
  // mode is handled separately so toggling these never resets a half-placed ruler.
  const refsKey = useMemo(() => JSON.stringify(referenceLengths ?? []), [referenceLengths]);
  useEffect(() => {
    if (!loaded) return;
    webRef.current?.injectJavaScript(`
      window.setReferenceLengths && window.setReferenceLengths(${JSON.stringify(refsKey)});
      window.setRenderMode && window.setRenderMode('${renderMode}');
      window.showDims && window.showDims(${showDimensions ? 'true' : 'false'});
      true;`);
  }, [loaded, refsKey, renderMode, showDimensions]);

  useEffect(() => {
    if (!loaded) return;
    webRef.current?.injectJavaScript(`window.setMeasureMode && window.setMeasureMode('${measureMode}');true;`);
  }, [loaded, measureMode]);

  // Frame the current selection — nonce-driven so re-selecting the SAME part
  // (after orbiting away) re-fires the zoom, mirroring cameraCommand.
  useEffect(() => {
    if (!loaded || !autoFocus || !focusNonce) return;
    const names = highlight ?? [];
    if (!names.length) return;
    webRef.current?.injectJavaScript(`window.focusOn && window.focusOn(${JSON.stringify(JSON.stringify(names))});true;`);
  }, [loaded, autoFocus, focusNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // One-shot camera moves (nonce-driven so the same preset re-fires).
  useEffect(() => {
    if (!loaded || !cameraCommand) return;
    webRef.current?.injectJavaScript(`window.setCamera && window.setCamera('${cameraCommand.preset}');true;`);
  }, [loaded, cameraCommand?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loaded || clearNonce == null) return;
    webRef.current?.injectJavaScript(`window.clearMeasure && window.clearMeasure();true;`);
  }, [loaded, clearNonce]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') sendModel();
      else if (msg.type === 'loaded') { setLoaded(true); onLoaded?.({ matched: msg.matched, dims: msg.dims }); }
      else if (msg.type === 'meshClicked') onMeshClicked?.(msg.name ?? null);
      else if (msg.type === 'measure') onMeasure?.({ mm: msg.mm ?? null, calibrated: !!msg.calibrated });
      else if (msg.type === 'dims') onDimensions?.({ l: msg.l, h: msg.h, d: msg.d, calibrated: !!msg.calibrated });
      else if (msg.type === 'calibrated') onCalibrated?.(typeof msg.mmPerWorld === 'number' ? msg.mmPerWorld : NaN);
    } catch {}
  }, [sendModel, onLoaded, onMeshClicked, onMeasure, onDimensions, onCalibrated]);

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
