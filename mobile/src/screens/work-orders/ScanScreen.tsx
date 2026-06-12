import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { WO } from '../../theme/wo';
import { ordersService, OrderStatusColors, OrderStatusLabels } from '../../services/projects.service';

/**
 * QR piece-mark scanner: point at a printed assembly label → resolve which
 * work orders build that assembly → jump straight to its work screen (or pick
 * the order when the same design is in production for several customers).
 *
 * Accepted payloads:
 *   {"t":"pcs-asm","p":"<projectId>","n":"<nodeId>"}   (printed by the web audit dashboard)
 *   pcs://asm/<projectId>/<nodeId>
 */
export function ScanScreen() {
  const navigation = useNavigation<any>();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{
    node: { id: string; mark: string; projectId: string };
    orders: { id: string; number: string; status: string; customerName: string | null }[];
  } | null>(null);
  const lockRef = useRef(false); // one resolve at a time; camera fires repeatedly

  const parse = (raw: string): { projectId: string; nodeId: string } | null => {
    try {
      const o = JSON.parse(raw);
      if (o && o.t === 'pcs-asm' && o.p && o.n) return { projectId: String(o.p), nodeId: String(o.n) };
    } catch { /* not JSON — try URI */ }
    const m = /^pcs:\/\/asm\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i.exec(raw.trim());
    if (m) return { projectId: m[1], nodeId: m[2] };
    return null;
  };

  const openAssembly = useCallback((orderId: string, projectId: string, nodeId: string, mark: string) => {
    setPicker(null);
    lockRef.current = false;
    navigation.navigate('AssemblyDetail', { orderId, projectId, nodeId, mark });
  }, [navigation]);

  const onScanned = useCallback(async ({ data }: { data: string }) => {
    if (lockRef.current || busy) return;
    const ref = parse(data);
    if (!ref) { setError('Not a PCS assembly label.'); return; }
    lockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await ordersService.resolveNode(ref.nodeId);
      const active = res.orders;
      if (active.length === 0) {
        setError(`${res.node.mark}: no work orders build this assembly yet.`);
        lockRef.current = false;
      } else if (active.length === 1) {
        openAssembly(active[0].id, res.node.projectId, res.node.id, res.node.mark);
      } else {
        setPicker({ node: { id: res.node.id, mark: res.node.mark, projectId: res.node.projectId }, orders: active });
      }
    } catch (e: any) {
      setError(e?.message || 'Could not resolve this label.');
      lockRef.current = false;
    } finally {
      setBusy(false);
    }
  }, [busy, openAssembly]);

  if (!permission) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="qr-code" size={42} color={WO.textSoft} />
        <Text style={styles.permTxt}>Camera access is needed to scan piece-mark labels.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnTxt}>Allow camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScanned}
      />
      {/* viewfinder */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame}>
          <View style={[styles.corner, styles.tl]} /><View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} /><View style={[styles.corner, styles.br]} />
        </View>
        <Text style={styles.hintTxt}>Point at an assembly label</Text>
      </View>
      {busy && <View style={styles.busy}><ActivityIndicator color={Colors.white} /></View>}
      {!!error && (
        <View style={styles.errBar}>
          <Ionicons name="alert-circle" size={15} color={Colors.white} />
          <Text style={styles.errTxt}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}><Text style={styles.errClose}>×</Text></TouchableOpacity>
        </View>
      )}

      {/* multiple orders build this assembly → pick one */}
      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => { setPicker(null); lockRef.current = false; }}>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{picker?.node.mark} is on {picker?.orders.length} work orders</Text>
              <TouchableOpacity onPress={() => { setPicker(null); lockRef.current = false; }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {picker?.orders.map((o) => (
              <TouchableOpacity key={o.id} style={styles.orow} onPress={() => picker && openAssembly(o.id, picker.node.projectId, picker.node.id, picker.node.mark)}>
                <Text style={styles.onum}>{o.number}</Text>
                <Text style={styles.ocust} numberOfLines={1}>{o.customerName || '—'}</Text>
                <View style={[styles.ochip, { backgroundColor: OrderStatusColors[o.status] || Colors.medium }]}>
                  <Text style={styles.ochipTxt}>{OrderStatusLabels[o.status] || o.status}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, backgroundColor: WO.mist },
  permTxt: { color: WO.textSoft, fontSize: 14, textAlign: 'center' },
  permBtn: { backgroundColor: WO.ink, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 },
  permBtnTxt: { color: WO.onInk, fontWeight: '800', fontSize: 14 },

  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 230, height: 230 },
  corner: { position: 'absolute', width: 34, height: 34, borderColor: '#ffffff', borderWidth: 4 },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 10 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 10 },
  hintTxt: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600', marginTop: 18 },
  busy: { position: 'absolute', top: 24, alignSelf: 'center' },

  errBar: { position: 'absolute', left: 14, right: 14, bottom: 24, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(198,40,40,0.95)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  errTxt: { flex: 1, color: Colors.white, fontSize: 13, fontWeight: '600' },
  errClose: { color: Colors.white, fontSize: 17, fontWeight: '800', paddingHorizontal: 4 },

  sheetWrap: { flex: 1, backgroundColor: 'rgba(8,26,36,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: WO.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: '60%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: WO.text, flex: 1, marginRight: 8 },
  sheetClose: { fontSize: 16, color: WO.textSoft, fontWeight: '700' },
  orow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: WO.line },
  onum: { fontSize: 14.5, fontWeight: '800', color: WO.text },
  ocust: { flex: 1, fontSize: 12.5, color: WO.textSoft },
  ochip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  ochipTxt: { color: Colors.white, fontSize: 10.5, fontWeight: '700' },
});
