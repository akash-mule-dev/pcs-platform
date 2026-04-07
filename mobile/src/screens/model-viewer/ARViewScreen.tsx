import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import WebView from 'react-native-webview';
import { Colors } from '../../theme/colors';
import { ModelsStackParamList } from '../../navigation/types';
import { environment } from '../../config/environment';

type Route = RouteProp<ModelsStackParamList, 'ARView'>;

export function ARViewScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation();
  const { modelId, fileUrl } = route.params;

  const [mode, setMode] = useState<'choice' | 'webxr' | 'fallback'>('choice');
  const webviewRef = useRef<WebView>(null);
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [isLocked, setIsLocked] = useState(false);
  const [isXray, setIsXray] = useState(false);

  // WebXR AR — opens in Chrome with full ARCore SLAM
  const launchWebXR = useCallback(() => {
    const arPageUrl = `https://akash-mule-dev.github.io/pcs-platform/ar-viewer.html?url=${encodeURIComponent(fileUrl)}&id=${modelId}`;
    Linking.openURL(arPageUrl).catch(() => {
      Alert.alert('Cannot open browser', 'Please install Chrome or another WebXR-compatible browser.');
    });
    // Go back since AR is now in browser
    navigation.goBack();
  }, [fileUrl, modelId, navigation]);

  // Fallback WebView AR (camera + Three.js, no SLAM)
  const startFallbackAR = useCallback(() => {
    setMode('fallback');
  }, []);

  const fetchAndSendModel = useCallback(async () => {
    try {
      setModelStatus('loading');
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const CHUNK = 512 * 1024;
      const totalChunks = Math.ceil(base64.length / CHUNK);
      webviewRef.current?.injectJavaScript(`
        window._modelChunks = [];
        window._totalChunks = ${totalChunks};
        document.getElementById('status').textContent = 'Receiving data...';
        true;
      `);
      for (let i = 0; i < totalChunks; i++) {
        const chunk = base64.substring(i * CHUNK, (i + 1) * CHUNK);
        const pct = Math.round(((i + 1) / totalChunks) * 100);
        webviewRef.current?.injectJavaScript(`
          window._modelChunks.push("${chunk}");
          document.getElementById('status').textContent = 'Downloading... ${pct}%';
          if (window._modelChunks.length === window._totalChunks) {
            loadModelFromBase64(window._modelChunks.join(''));
          }
          true;
        `);
      }
    } catch {
      setModelStatus('error');
    }
  }, [fileUrl]);

  const onWebViewMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'ready') fetchAndSendModel();
      else if (data.type === 'loaded') setModelStatus('loaded');
      else if (data.type === 'error') setModelStatus('error');
    } catch {}
  }, [fetchAndSendModel]);

  const toggleLock = useCallback(() => {
    const next = !isLocked;
    setIsLocked(next);
    webviewRef.current?.injectJavaScript(`window.setLocked(${next}); true;`);
  }, [isLocked]);

  const toggleXray = useCallback(() => {
    const next = !isXray;
    setIsXray(next);
    webviewRef.current?.injectJavaScript(`window.setXrayMode(${next}); true;`);
  }, [isXray]);

  const adjustScale = useCallback((factor: number) => {
    webviewRef.current?.injectJavaScript(`
      window.scale = Math.max(0.1, Math.min(5, window.scale * ${factor}));
      if (window.model) window.model.scale.set(window.scale, window.scale, window.scale);
      true;
    `);
  }, []);

  // ── Choice Screen ──
  if (mode === 'choice') {
    return (
      <View style={styles.container}>
        <Ionicons name="glasses-outline" size={64} color={Colors.primary} />
        <Text style={styles.titleText}>AR QA Inspector</Text>
        <Text style={styles.descText}>
          Overlay the 3D model on your real product{'\n'}
          and walk around to inspect quality.
        </Text>

        {/* Primary: WebXR in Chrome */}
        <TouchableOpacity style={styles.primaryButton} onPress={launchWebXR}>
          <Ionicons name="navigate" size={22} color={Colors.white} />
          <View>
            <Text style={styles.primaryButtonText}>AR with SLAM Tracking</Text>
            <Text style={styles.primaryButtonSub}>Opens in browser - walk around the object</Text>
          </View>
        </TouchableOpacity>

        {/* Secondary: In-app fallback */}
        <TouchableOpacity style={styles.secondaryButton} onPress={startFallbackAR}>
          <Ionicons name="phone-portrait-outline" size={22} color={Colors.primary} />
          <View>
            <Text style={styles.secondaryButtonText}>Quick AR Preview</Text>
            <Text style={styles.secondaryButtonSub}>In-app camera overlay - no SLAM</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Fallback WebView AR ──
  return (
    <View style={styles.arContainer}>
      <WebView
        ref={webviewRef}
        source={{ html: FALLBACK_AR_HTML, baseUrl: 'https://localhost' }}
        style={styles.webviewOverlay}
        originWhitelist={['*']}
        javaScriptEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        onMessage={onWebViewMessage}
        onPermissionRequest={(event: any) => event.nativeEvent?.grant?.()}
      />

      {modelStatus === 'loaded' && (
        <>
          <TouchableOpacity
            style={[styles.lockButton, isLocked ? styles.lockButtonLocked : styles.lockButtonUnlocked]}
            onPress={toggleLock}
          >
            <Ionicons name={isLocked ? 'lock-open' : 'lock-closed'} size={22} color="#fff" />
            <Text style={styles.lockButtonText}>{isLocked ? 'UNLOCK' : 'LOCK'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.xrayButton, isXray ? styles.xrayActive : styles.xrayInactive]}
            onPress={toggleXray}
          >
            <Ionicons name="scan-outline" size={20} color="#fff" />
            <Text style={styles.xrayText}>{isXray ? 'SOLID' : 'X-RAY'}</Text>
          </TouchableOpacity>
        </>
      )}

      <View style={styles.arControls}>
        {!isLocked && (
          <>
            <TouchableOpacity style={styles.arControlBtn} onPress={() => adjustScale(1.3)}>
              <Ionicons name="add" size={24} color={Colors.white} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.arControlBtn} onPress={() => adjustScale(0.7)}>
              <Ionicons name="remove" size={24} color={Colors.white} />
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          style={[styles.arControlBtn, { backgroundColor: Colors.danger }]}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="close" size={24} color={Colors.white} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.arBackBtn} onPress={() => navigation.goBack()}>
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

// ── Fallback HTML (camera + Three.js, no SLAM) ──
const FALLBACK_AR_HTML = `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
*{margin:0;padding:0;overflow:hidden}
body{background:#000;width:100vw;height:100vh}
#cam{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0}
canvas{position:absolute;top:0;left:0;width:100%!important;height:100%!important;z-index:1}
#status{position:absolute;top:20px;left:50%;transform:translateX(-50%);
  background:rgba(0,0,0,0.7);color:#fff;padding:10px 20px;border-radius:20px;
  font-family:sans-serif;font-size:14px;z-index:10;text-align:center;transition:all 0.3s}
</style>
</head><body>
<video id="cam" autoplay playsinline muted></video>
<div id="status">Loading model...</div>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const status = document.getElementById('status');
let scene, camera, renderer, model;
let scale = 1, isDragging = false;
let lastTouchX = 0, lastTouchY = 0, modelRotX = 0, modelRotY = 0;
let pinchStartDist = 0, pinchStartScale = 1;
let edgeLines = [], originalMaterials = new Map();
window.model = null; window.scale = 1; window._locked = false;

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    document.getElementById('cam').srcObject = stream;
  } catch(e) {
    document.body.style.background = 'linear-gradient(135deg,#1a1a2e,#0f3460)';
  }
}

function init() {
  startCamera();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 0.5, 2);
  camera.lookAt(0, 0, 0);
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  document.body.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const d1 = new THREE.DirectionalLight(0xffffff, 1.0); d1.position.set(2,4,3); scene.add(d1);
  const d2 = new THREE.DirectionalLight(0x88aaff, 0.4); d2.position.set(-3,1,-2); scene.add(d2);
  renderer.domElement.addEventListener('touchstart', onTS, { passive: false });
  renderer.domElement.addEventListener('touchmove', onTM, { passive: false });
  renderer.domElement.addEventListener('touchend', () => { isDragging = false; }, { passive: false });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  (function anim() { requestAnimationFrame(anim); renderer.render(scene, camera); })();
}

function onTS(e) {
  e.preventDefault(); if (window._locked) return;
  if (e.touches.length === 1) { isDragging = true; lastTouchX = e.touches[0].clientX; lastTouchY = e.touches[0].clientY; }
  else if (e.touches.length === 2) { isDragging = false; pinchStartDist = getTD(e.touches); pinchStartScale = scale; }
}
function onTM(e) {
  e.preventDefault(); if (window._locked) return;
  if (e.touches.length === 1 && isDragging && model) {
    modelRotY += (e.touches[0].clientX - lastTouchX) * 0.01;
    modelRotX += (e.touches[0].clientY - lastTouchY) * 0.01;
    modelRotX = Math.max(-Math.PI/3, Math.min(Math.PI/3, modelRotX));
    model.rotation.y = modelRotY; model.rotation.x = modelRotX;
    lastTouchX = e.touches[0].clientX; lastTouchY = e.touches[0].clientY;
  } else if (e.touches.length === 2 && model) {
    scale = Math.max(0.1, Math.min(5, pinchStartScale * (getTD(e.touches) / pinchStartDist)));
    model.scale.set(scale, scale, scale); window.scale = scale;
  }
}
function getTD(t) { return Math.sqrt((t[0].clientX-t[1].clientX)**2 + (t[0].clientY-t[1].clientY)**2); }

window.setLocked = function(v) {
  window._locked = v; isDragging = false;
  status.textContent = v ? 'LOCKED \\u2014 Model anchored' : 'Drag to position \\u00b7 Lock to anchor';
  status.style.background = v ? 'rgba(46,125,50,0.85)' : 'rgba(0,0,0,0.7)';
  status.style.opacity = '1';
};

window.setXrayMode = function(on) {
  if (!model) return;
  edgeLines.forEach(l => { l.parent?.remove(l); l.geometry.dispose(); l.material.dispose(); });
  edgeLines = [];
  model.traverse(c => {
    if (!c.isMesh) return;
    if (on) {
      if (!originalMaterials.has(c.uuid)) originalMaterials.set(c.uuid, c.material.clone());
      c.material = new THREE.MeshStandardMaterial({ color:0x1e88e5, transparent:true, opacity:0.06, depthWrite:false, side:THREE.DoubleSide, roughness:0.8 });
      c.renderOrder = 0;
      const edges = new THREE.EdgesGeometry(c.geometry, 25);
      const ls = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color:0x64b5f6, opacity:1, transparent:true }));
      ls.renderOrder = 1; c.add(ls); edgeLines.push(ls);
    } else {
      const o = originalMaterials.get(c.uuid); if (o) c.material = o.clone(); c.renderOrder = 0;
    }
  });
};

window._modelChunks = []; window._totalChunks = 0;
window.loadModelFromBase64 = function(b64) {
  try {
    status.textContent = 'Parsing model...';
    const bin = atob(b64); const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    new GLTFLoader().parse(buf.buffer, '', (gltf) => {
      model = gltf.scene; window.model = model;
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const s = 1.5 / Math.max(size.x, size.y, size.z);
      model.scale.set(s, s, s); scale = s; window.scale = s;
      model.position.sub(center.multiplyScalar(s));
      model.traverse(c => { if (c.isMesh) originalMaterials.set(c.uuid, c.material.clone()); });
      scene.add(model);
      status.textContent = 'Drag to position \\u00b7 Lock to anchor';
      setTimeout(() => { status.style.opacity = '0.4'; }, 3000);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'loaded'}));
    }, (err) => {
      status.textContent = 'Error: ' + (err.message || err);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'error'}));
    });
  } catch(e) {
    status.textContent = 'Error: ' + e.message;
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'error'}));
  }
};
window.resetModel = function() {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  scale = 1.5 / Math.max(size.x, size.y, size.z);
  window.scale = scale; model.scale.set(scale,scale,scale);
  modelRotX = 0; modelRotY = 0; model.rotation.set(0,0,0);
};
init();
window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));
</script></body></html>`;

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: Colors.background,
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  titleText: { fontSize: 24, fontWeight: '700', color: Colors.text, marginTop: 16 },
  descText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginTop: 12, lineHeight: 20, marginBottom: 24 },
  primaryButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary,
    paddingHorizontal: 24, paddingVertical: 16, borderRadius: 12, width: '100%', gap: 14,
  },
  primaryButtonText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  primaryButtonSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  secondaryButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white,
    paddingHorizontal: 24, paddingVertical: 16, borderRadius: 12, width: '100%', gap: 14,
    marginTop: 12, borderWidth: 1, borderColor: Colors.border,
  },
  secondaryButtonText: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  secondaryButtonSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  backButton: { marginTop: 20, padding: 12 },
  backButtonText: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
  arContainer: { flex: 1, backgroundColor: '#000' },
  webviewOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
  lockButton: {
    position: 'absolute', bottom: 30, left: 16, right: 80,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 14, borderRadius: 14,
  },
  lockButtonUnlocked: { backgroundColor: 'rgba(21,101,192,0.9)' },
  lockButtonLocked: { backgroundColor: 'rgba(198,40,40,0.9)' },
  lockButtonText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  xrayButton: {
    position: 'absolute', bottom: 90, left: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10,
  },
  xrayInactive: { backgroundColor: 'rgba(100,100,100,0.8)' },
  xrayActive: { backgroundColor: 'rgba(0,150,136,0.9)' },
  xrayText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  arControls: { position: 'absolute', right: 16, bottom: 100, gap: 12 },
  arControlBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center',
  },
  arBackBtn: {
    position: 'absolute', top: 50, left: 16,
    backgroundColor: 'rgba(0,0,0,0.6)', width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
});
