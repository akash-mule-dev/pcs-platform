import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Colors } from '../../theme/colors';
import { ModelsStackParamList } from '../../navigation/types';

type Route = RouteProp<ModelsStackParamList, 'ModelView'>;

const VIEWER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;">
<style>
  * { margin: 0; padding: 0; }
  body { background: #1a1a2e; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; touch-action: none; }
  #loading { position: fixed; inset: 0; display: flex; flex-direction: column;
    justify-content: center; align-items: center; background: rgba(26,26,46,0.95); color: #fff; font-family: sans-serif; }
  #progress-bar { width: 60%; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; margin-top: 12px; }
  #progress-fill { height: 100%; background: #1565c0; border-radius: 3px; width: 0%; transition: width 0.2s; }
  #error { color: #c62828; word-break: break-all; padding: 20px; }
</style>
</head>
<body>
<div id="loading">
  <div>Loading model...</div>
  <div style="margin-top:8px" id="pct">Initializing 3D engine...</div>
  <div id="progress-bar"><div id="progress-fill"></div></div>
</div>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

var scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
var camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.5, 3);
var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);
var controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
var dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(5, 10, 7);
scene.add(dir);
scene.add(new THREE.GridHelper(10, 10, 0x444444, 0x333333));

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', function() {
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById('pct').textContent = '3D engine ready';

window.loadModelFromBase64 = function(base64Data) {
  document.getElementById('pct').textContent = 'Parsing model...';
  document.getElementById('progress-fill').style.width = '80%';
  try {
    var binary = atob(base64Data);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var loader = new GLTFLoader();
    loader.parse(bytes.buffer, '', function(gltf) {
      var model = gltf.scene;
      var box = new THREE.Box3().setFromObject(model);
      var center = box.getCenter(new THREE.Vector3());
      var size = box.getSize(new THREE.Vector3());
      var s = 2 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(s);
      model.position.sub(center.multiplyScalar(s));
      scene.add(model);
      document.getElementById('loading').style.display = 'none';
      document.getElementById('progress-fill').style.width = '100%';
    }, function(err) {
      document.getElementById('loading').innerHTML = '<div id="error">Parse error: ' + (err.message || err) + '</div>';
    });
  } catch(e) {
    document.getElementById('loading').innerHTML = '<div id="error">Error: ' + e.message + '</div>';
  }
};

// Signal ready
window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));
</script>
</body>
</html>`;

export function ModelViewScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<any>();
  const { modelId, modelName, fileUrl } = route.params;
  const webviewRef = useRef<WebView>(null);
  const [fetching, setFetching] = useState(false);

  const fetchAndSendModel = useCallback(async () => {
    if (fetching) return;
    setFetching(true);
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();

      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const CHUNK = 512 * 1024;
      const totalChunks = Math.ceil(base64.length / CHUNK);

      webviewRef.current?.injectJavaScript(`
        window._modelChunks = [];
        window._totalChunks = ${totalChunks};
        document.getElementById('pct').textContent = 'Receiving data...';
        true;
      `);

      for (let i = 0; i < totalChunks; i++) {
        const chunk = base64.substring(i * CHUNK, (i + 1) * CHUNK);
        const pct = Math.round(((i + 1) / totalChunks) * 50);
        webviewRef.current?.injectJavaScript(`
          window._modelChunks.push("${chunk}");
          document.getElementById('pct').textContent = 'Downloading... ${pct}%';
          document.getElementById('progress-fill').style.width = '${pct}%';
          if (window._modelChunks.length === window._totalChunks) {
            window.loadModelFromBase64(window._modelChunks.join(''));
          }
          true;
        `);
      }
    } catch (err: any) {
      webviewRef.current?.injectJavaScript(`
        document.getElementById('loading').innerHTML = '<div id="error">Fetch error: ${err.message.replace(/'/g, "\\'")}</div>';
        true;
      `);
    }
    setFetching(false);
  }, [fileUrl, fetching]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'ready') {
        fetchAndSendModel();
      }
    } catch {}
  }, [fetchAndSendModel]);

  const onLoadEnd = useCallback(() => {
    setTimeout(() => fetchAndSendModel(), 2000);
  }, [fetchAndSendModel]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        style={styles.webview}
        originWhitelist={['*']}
        source={{ html: VIEWER_HTML }}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        onMessage={onMessage}
        onLoadEnd={onLoadEnd}
      />
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlButton, { backgroundColor: Colors.tertiary }]}
          onPress={() => navigation.navigate('ARView', { modelId, fileUrl: `${fileUrl}/ar` })}
        >
          <Ionicons name="glasses-outline" size={22} color={Colors.white} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  webview: { flex: 1, backgroundColor: '#1a1a2e' },
  controls: { position: 'absolute', right: 16, bottom: 32, gap: 12 },
  controlButton: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
});
