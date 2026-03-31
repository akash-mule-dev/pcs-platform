import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { Colors } from '../../theme/colors';
import { api } from '../../services/api.service';
import { QualityEntry } from '../../types';
import { ModelsStackParamList } from '../../navigation/types';

type Route = RouteProp<ModelsStackParamList, 'QualityView'>;

function buildQualityViewerHtml(fileUrl: string, qualityJson: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
  * { margin: 0; padding: 0; }
  body { background: #1a1a2e; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; touch-action: none; }
  #loading { position: fixed; inset: 0; display: flex; justify-content: center;
    align-items: center; background: rgba(26,26,46,0.95); color: #fff; font-family: sans-serif; }
</style>
</head>
<body>
<div id="loading">Loading model...</div>
<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/examples/js/loaders/GLTFLoader.js"></script>
<script>
(function(){
  var qualityData = ${qualityJson};
  var statusColors = { pass: 0x2e7d32, fail: 0xc62828, warning: 0xf9a825 };

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  var camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 1000);
  camera.position.set(0, 1.5, 3);
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  var dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 7);
  scene.add(dir);
  scene.add(new THREE.GridHelper(10, 10, 0x444444, 0x333333));

  new THREE.GLTFLoader().load('${fileUrl}', function(gltf) {
    var model = gltf.scene;
    var box = new THREE.Box3().setFromObject(model);
    var center = box.getCenter(new THREE.Vector3());
    var size = box.getSize(new THREE.Vector3());
    var s = 2 / Math.max(size.x, size.y, size.z);
    model.scale.setScalar(s);
    model.position.sub(center.multiplyScalar(s));
    model.traverse(function(child) {
      if (child.isMesh && child.name) {
        var q = qualityData.find(function(e) { return e.meshName === child.name; });
        if (q) {
          child.material = new THREE.MeshStandardMaterial({
            color: statusColors[q.status] || 0x757575,
            transparent: true, opacity: 0.85
          });
        }
      }
    });
    scene.add(model);
    document.getElementById('loading').style.display = 'none';
  });

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
})();
</script>
</body>
</html>`;
}

export function QualityViewScreen() {
  const route = useRoute<Route>();
  const { modelId, modelName, fileUrl } = route.params;
  const [qualityData, setQualityData] = useState<QualityEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<QualityEntry | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const passCount = qualityData.filter((q) => q.status === 'pass').length;
  const failCount = qualityData.filter((q) => q.status === 'fail').length;
  const warnCount = qualityData.filter((q) => q.status === 'warning').length;

  useEffect(() => {
    api
      .get<QualityEntry[]>(`/quality-data/by-model/${modelId}`)
      .then((data) => setQualityData(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [modelId]);

  const openDetail = (entry: QualityEntry) => {
    setSelectedEntry(entry);
    setShowDetail(true);
  };

  return (
    <View style={styles.container}>
      {/* 3D Viewer */}
      <View style={styles.viewerWrap}>
        <WebView
          style={{ flex: 1 }}
          originWhitelist={['*']}
          source={{
            html: buildQualityViewerHtml(
              fileUrl,
              JSON.stringify(qualityData),
            ),
          }}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
        />
      </View>

      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <View style={[styles.summaryItem, { backgroundColor: '#e8f5e9' }]}>
          <Text style={[styles.summaryCount, { color: Colors.success }]}>{passCount}</Text>
          <Text style={styles.summaryLabel}>Pass</Text>
        </View>
        <View style={[styles.summaryItem, { backgroundColor: '#ffebee' }]}>
          <Text style={[styles.summaryCount, { color: Colors.danger }]}>{failCount}</Text>
          <Text style={styles.summaryLabel}>Fail</Text>
        </View>
        <View style={[styles.summaryItem, { backgroundColor: '#fff8e1' }]}>
          <Text style={[styles.summaryCount, { color: Colors.warning }]}>{warnCount}</Text>
          <Text style={styles.summaryLabel}>Warning</Text>
        </View>
      </View>

      {/* Quality entries list */}
      <ScrollView style={styles.entriesList}>
        {qualityData.map((entry) => {
          const statusColor =
            entry.status === 'pass' ? Colors.success
            : entry.status === 'fail' ? Colors.danger
            : Colors.warning;
          return (
            <TouchableOpacity
              key={entry.id}
              style={styles.entryCard}
              onPress={() => openDetail(entry)}
            >
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <View style={styles.entryInfo}>
                <Text style={styles.entryMesh}>{entry.meshName}</Text>
                <Text style={styles.entryStatus}>
                  {entry.status.toUpperCase()}
                  {entry.defectType ? ` — ${entry.defectType}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.medium} />
            </TouchableOpacity>
          );
        })}
        {qualityData.length === 0 && (
          <Text style={styles.emptyText}>No quality data for this model</Text>
        )}
      </ScrollView>

      {/* Detail Modal */}
      <Modal visible={showDetail} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedEntry?.meshName || 'Detail'}</Text>
              <TouchableOpacity onPress={() => setShowDetail(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {selectedEntry && (
              <ScrollView>
                <View
                  style={[
                    styles.statusBox,
                    {
                      backgroundColor:
                        selectedEntry.status === 'pass' ? '#e8f5e9'
                        : selectedEntry.status === 'fail' ? '#ffebee'
                        : '#fff8e1',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBoxText,
                      {
                        color:
                          selectedEntry.status === 'pass' ? Colors.success
                          : selectedEntry.status === 'fail' ? Colors.danger
                          : Colors.warning,
                      },
                    ]}
                  >
                    {selectedEntry.status.toUpperCase()}
                  </Text>
                </View>
                <DetailRow label="Inspector" value={selectedEntry.inspector ? `${selectedEntry.inspector.firstName} ${selectedEntry.inspector.lastName}` : '—'} />
                <DetailRow label="Date" value={new Date(selectedEntry.createdAt).toLocaleDateString()} />
                <DetailRow label="Defect Type" value={selectedEntry.defectType || '—'} />
                <DetailRow label="Severity" value={selectedEntry.severity?.toUpperCase() || '—'} />
                <DetailRow label="Measurement" value={selectedEntry.measurement !== null ? String(selectedEntry.measurement) : '—'} />
                <DetailRow label="Tolerance" value={selectedEntry.toleranceMin !== null && selectedEntry.toleranceMax !== null ? `${selectedEntry.toleranceMin} – ${selectedEntry.toleranceMax}` : '—'} />
                <DetailRow label="Notes" value={selectedEntry.notes || '—'} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  viewerWrap: { height: '40%' },
  summaryBar: { flexDirection: 'row', padding: 12, gap: 8 },
  summaryItem: { flex: 1, borderRadius: 8, padding: 10, alignItems: 'center' },
  summaryCount: { fontSize: 20, fontWeight: '700' },
  summaryLabel: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  entriesList: { flex: 1, paddingHorizontal: 12 },
  entryCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white, borderRadius: 8, padding: 12, marginBottom: 8 },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  entryInfo: { flex: 1 },
  entryMesh: { fontSize: 14, fontWeight: '600', color: Colors.text },
  entryStatus: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  emptyText: { textAlign: 'center', color: Colors.medium, marginTop: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '60%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  statusBox: { borderRadius: 8, padding: 12, alignItems: 'center', marginBottom: 16 },
  statusBoxText: { fontSize: 16, fontWeight: '700' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  detailLabel: { fontSize: 14, color: Colors.textSecondary },
  detailValue: { fontSize: 14, fontWeight: '500', color: Colors.text, maxWidth: '60%', textAlign: 'right' },
});
