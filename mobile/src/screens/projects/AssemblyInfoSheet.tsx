import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  ActivityIndicator, Image, Share, Alert, Platform, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { Colors } from '../../theme/colors';
import { WO, SHIP_META } from '../../theme/wo';
import {
  projectsService, MNode, MNodeAudit, MAssemblyDocument, MNodeLot,
} from '../../services/projects.service';
import { authService } from '../../services/auth.service';
import {
  buildFabricationRows, groupNodeProperties, ifcClassLabel, nodeTypeLabel, InfoRow,
} from './assembly-info';

interface Props {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  nodeId: string;
  mark: string;
  node: MNode | null;
  audit: MNodeAudit | null;
}

function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
function fmtSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDur(total: number): string {
  const v = Math.max(0, Math.floor(total));
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function docIcon(contentType: string): keyof typeof Ionicons.glyphMap {
  if (contentType?.startsWith('image/')) return 'image-outline';
  if (contentType === 'application/pdf') return 'document-text-outline';
  return 'document-outline';
}

/** A titled card grouping a set of rows. */
function Section({ icon, title, count, children }: {
  icon: keyof typeof Ionicons.glyphMap; title: string; count?: number; children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={15} color={WO.accent} />
        <Text style={styles.sectionTitle}>{title}</Text>
        {count != null && <Text style={styles.sectionCount}>{count}</Text>}
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function KV({ label, value, last, mono }: { label: string; value: string; last?: boolean; mono?: boolean }) {
  return (
    <View style={[styles.kv, last && styles.kvLast]}>
      <Text style={styles.kvK} numberOfLines={2}>{label}</Text>
      <Text style={[styles.kvV, mono && styles.kvMono]} numberOfLines={3} selectable>{value}</Text>
    </View>
  );
}

/**
 * Rich, data-first Assembly Info bottom sheet. Surfaces the identity, fabrication
 * spec (falling back to the IFC properties bag when promoted columns are blank),
 * production state, structure, attached shop drawings, heat-number traceability,
 * and the full grouped IFC/Tekla/SDS2 property set — instead of the old handful
 * of frequently-empty columns.
 */
export function AssemblyInfoSheet({ visible, onClose, projectId, nodeId, mark, node, audit }: Props) {
  const [documents, setDocuments] = useState<MAssemblyDocument[] | null>(null);
  const [lots, setLots] = useState<MNodeLot[] | null>(null);
  const [parent, setParent] = useState<MNode | null>(null);
  const [partCount, setPartCount] = useState<number | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [propsOpen, setPropsOpen] = useState(true);
  const [preview, setPreview] = useState<{ uri: string; headers?: Record<string, string>; name: string } | null>(null);
  const docsLoadedRef = useRef(false); // documents + lots (need only nodeId)
  const enrichLoadedRef = useRef(false); // parent + part count (need the loaded node)

  // Reset enrichment whenever the node changes (the screen is per-node, but be safe).
  useEffect(() => {
    docsLoadedRef.current = false;
    enrichLoadedRef.current = false;
    setDocuments(null); setLots(null); setParent(null); setPartCount(null);
  }, [nodeId]);

  // Drop any open image preview when the sheet closes (avoids a stale flash on reopen).
  useEffect(() => {
    if (!visible) setPreview(null);
  }, [visible]);

  // Documents + heat lots depend only on the node id — fetch once the sheet opens.
  useEffect(() => {
    if (!visible || docsLoadedRef.current) return;
    docsLoadedRef.current = true;
    Promise.all([
      projectsService.getNodeDocuments(projectId, nodeId).catch(() => [] as MAssemblyDocument[]),
      projectsService.getNodeLots(projectId, nodeId).catch(() => [] as MNodeLot[]),
    ]).then(([docs, lts]) => {
      setDocuments(docs); setLots(lts);
    });
  }, [visible, projectId, nodeId]);

  // Parent breadcrumb + piece count need the loaded node — run once it's available
  // (it may arrive after the sheet has already opened), and never before.
  useEffect(() => {
    if (!visible || !node || enrichLoadedRef.current) return;
    enrichLoadedRef.current = true;
    (async () => {
      const isContainer = node.nodeType !== 'part';
      const [par, meshes] = await Promise.all([
        node.parentId ? projectsService.getNode(projectId, node.parentId).catch(() => null) : Promise.resolve(null),
        isContainer ? projectsService.getNodeMeshes(projectId, nodeId).catch(() => [] as string[]) : Promise.resolve([] as string[]),
      ]);
      setParent(par);
      // nodeMeshNames returns this node's OWN mesh plus every descendant's — drop
      // the container's own entry so the count reflects the pieces inside it.
      const own = node.meshName || node.ifcGuid;
      setPartCount(isContainer ? (meshes.filter((m) => m !== own).length || null) : null);
    })();
  }, [visible, node, projectId, nodeId]);

  const fabRows = useMemo<InfoRow[]>(() => buildFabricationRows(node, node?.properties), [node]);
  const propGroups = useMemo(() => groupNodeProperties(node?.properties), [node]);
  const propCount = useMemo(() => propGroups.reduce((a, g) => a + g.rows.length, 0), [propGroups]);
  const ifcLabel = ifcClassLabel(node?.ifcClass);
  const typeLabel = nodeTypeLabel(node?.nodeType);

  const productionRows = useMemo<InfoRow[]>(() => {
    if (!audit) return [];
    const out: InfoRow[] = [];
    out.push({ label: 'Work order', value: audit.workOrderNumber });
    out.push({ label: 'Progress', value: `${Math.round(audit.percentComplete)}% · ${audit.unitsDone}/${audit.unitsTotal} units` });
    out.push({ label: 'Shipping', value: SHIP_META[audit.shipStatus]?.label ?? 'In production' });
    if (audit.shippedQty > 0) out.push({ label: 'Shipped', value: `${audit.shippedQty}` });
    // The mobile audit endpoint sends ncr status as a binary 'open' | 'resolved'.
    const openNcrs = audit.ncrs.filter((n) => n.status === 'open').length;
    if (openNcrs > 0) out.push({ label: 'Open NCRs', value: `${openNcrs}` });
    const time = audit.timeEntries.reduce((a, t) => a + (t.durationSeconds || 0), 0);
    if (time > 0) out.push({ label: 'Logged time', value: fmtDur(time) });
    return out;
  }, [audit]);

  const structureRows = useMemo<InfoRow[]>(() => {
    const out: InfoRow[] = [];
    out.push({ label: 'Type', value: ifcLabel ? `${typeLabel} · ${ifcLabel}` : typeLabel });
    if (parent && parent.id !== nodeId) {
      out.push({ label: 'Belongs to', value: parent.mark || parent.name || '—' });
    }
    if (node && node.nodeType !== 'part' && partCount) {
      out.push({ label: 'Parts in 3D model', value: `${partCount}` });
    }
    if (node?.ifcGuid) out.push({ label: 'IFC GUID', value: node.ifcGuid });
    return out;
  }, [node, parent, partCount, ifcLabel, typeLabel, nodeId]);

  const openDoc = useCallback(async (doc: MAssemblyDocument) => {
    const url = projectsService.nodeDocumentFileUrl(projectId, doc.id);
    const token = await authService.getToken().catch(() => null);
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    if (doc.contentType?.startsWith('image/')) {
      setPreview({ uri: url, headers, name: doc.originalName });
      return;
    }
    // PDFs / other: download to cache with auth, then hand to the OS share/open sheet.
    setOpening(doc.id);
    try {
      const safe = (doc.originalName || `document-${doc.id}`).replace(/[^\w.\-]+/g, '_');
      const target = `${FileSystem.cacheDirectory}${doc.id}-${safe}`;
      const dl = await FileSystem.createDownloadResumable(url, target, { headers: headers ?? {} }).downloadAsync();
      if (!dl?.uri) throw new Error('download failed');
      if (Platform.OS === 'ios') {
        await Share.share({ url: dl.uri, title: doc.originalName });
      } else {
        await Linking.openURL(dl.uri).catch(async () => { await Share.share({ message: dl.uri, title: doc.originalName }); });
      }
    } catch {
      Alert.alert('Open document', 'Could not open this file on your device.');
    } finally {
      setOpening(null);
    }
  }, [projectId]);

  const subtitle = [typeLabel, ifcLabel].filter(Boolean).join(' · ');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>{mark}</Text>
              {!!node?.name && node.name !== mark && <Text style={styles.sub} numberOfLines={1}>{node.name}</Text>}
              {!!subtitle && <Text style={styles.subTag} numberOfLines={1}>{subtitle}</Text>}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ marginTop: 6 }} contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
            {fabRows.length > 0 && (
              <Section icon="construct-outline" title="Fabrication">
                {fabRows.map((r, i) => <KV key={r.label} label={r.label} value={r.value} last={i === fabRows.length - 1} />)}
              </Section>
            )}

            {productionRows.length > 0 && (
              <Section icon="git-commit-outline" title="Production">
                {productionRows.map((r, i) => <KV key={r.label} label={r.label} value={r.value} last={i === productionRows.length - 1} />)}
              </Section>
            )}

            {structureRows.length > 0 && (
              <Section icon="git-network-outline" title="Structure">
                {structureRows.map((r, i) => (
                  <KV key={r.label} label={r.label} value={r.value} last={i === structureRows.length - 1} mono={r.label === 'IFC GUID'} />
                ))}
              </Section>
            )}

            {/* Documents */}
            <Section icon="documents-outline" title="Shop drawings & docs" count={documents?.length}>
              {documents === null ? (
                <View style={styles.inlineLoad}><ActivityIndicator size="small" color={Colors.primary} /></View>
              ) : documents.length === 0 ? (
                <Text style={styles.empty}>No drawings or documents attached to this piece.</Text>
              ) : (
                documents.map((d, i) => (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.docRow, i === documents.length - 1 && styles.kvLast]}
                    onPress={() => openDoc(d)}
                    disabled={opening === d.id}
                  >
                    <Ionicons name={docIcon(d.contentType)} size={20} color={WO.accent} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.docName} numberOfLines={1}>{d.label || d.originalName}</Text>
                      <Text style={styles.docMeta} numberOfLines={1}>
                        {[fmtSize(d.size), d.createdByName, fmtStamp(d.createdAt)].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {opening === d.id
                      ? <ActivityIndicator size="small" color={Colors.primary} />
                      : <Ionicons name="open-outline" size={18} color={Colors.textSecondary} />}
                  </TouchableOpacity>
                ))
              )}
            </Section>

            {/* Traceability (heat numbers) */}
            <Section icon="flame-outline" title="Material traceability" count={lots?.length || undefined}>
              {lots === null ? (
                <View style={styles.inlineLoad}><ActivityIndicator size="small" color={Colors.primary} /></View>
              ) : lots.length === 0 ? (
                <Text style={styles.empty}>No material lots / heat numbers assigned yet.</Text>
              ) : (
                lots.map((l, i) => (
                  <View key={l.id} style={[styles.kv, i === lots.length - 1 && styles.kvLast]}>
                    <Text style={styles.kvK} numberOfLines={2}>
                      Heat {l.heat_number || '—'}{l.lot_number ? `  ·  Lot ${l.lot_number}` : ''}
                    </Text>
                    <Text style={styles.kvV} numberOfLines={2}>
                      {[l.material_name || l.material_code, l.supplier, l.cert_reference ? `Cert ${l.cert_reference}` : null]
                        .filter(Boolean).join(' · ') || `×${l.quantity}`}
                    </Text>
                  </View>
                ))
              )}
            </Section>

            {/* Imported properties (the IFC / Tekla / SDS2 bag) */}
            {propGroups.length > 0 && (
              <View style={styles.section}>
                <TouchableOpacity style={styles.sectionHead} onPress={() => setPropsOpen((o) => !o)} activeOpacity={0.7}>
                  <Ionicons name="layers-outline" size={15} color={WO.accent} />
                  <Text style={styles.sectionTitle}>Imported properties</Text>
                  <Text style={styles.sectionCount}>{propCount}</Text>
                  <View style={{ flex: 1 }} />
                  <Ionicons name={propsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
                </TouchableOpacity>
                {propsOpen && (
                  <View style={styles.card}>
                    {propGroups.map((g, gi) => (
                      <View key={g.title} style={gi > 0 ? styles.propGroup : undefined}>
                        <Text style={styles.propGroupTitle}>{g.title}</Text>
                        {g.rows.map((r, ri) => (
                          <KV key={`${g.title}.${r.label}`} label={r.label} value={r.value} last={ri === g.rows.length - 1} />
                        ))}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {fabRows.length === 0 && productionRows.length === 0 && propGroups.length === 0 && !node && (
              <Text style={styles.empty}>No details available for this assembly.</Text>
            )}
          </ScrollView>
        </View>
      </View>

      {/* Full-screen image preview (drawings stored as images) */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={styles.previewWrap}>
          <View style={styles.previewBar}>
            <Text style={styles.previewName} numberOfLines={1}>{preview?.name}</Text>
            <TouchableOpacity onPress={() => setPreview(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          {preview && (
            <Image
              source={{ uri: preview.uri, headers: preview.headers }}
              style={styles.previewImg}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: WO.mist, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingTop: 16, maxHeight: '88%' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 20, fontWeight: '800', color: WO.text, letterSpacing: 0.2 },
  sub: { fontSize: 13, color: WO.textSoft, marginTop: 1 },
  subTag: { fontSize: 11.5, fontWeight: '700', color: WO.accent, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.4 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: WO.muteBg, alignItems: 'center', justifyContent: 'center' },

  section: { marginTop: 16 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: WO.textSoft, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionCount: { fontSize: 11, fontWeight: '800', color: WO.accent, backgroundColor: WO.infoBg, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
  card: { backgroundColor: WO.card, borderRadius: 12, borderWidth: 1, borderColor: WO.line, paddingHorizontal: 12 },

  kv: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: WO.line },
  kvLast: { borderBottomWidth: 0 },
  kvK: { color: WO.textSoft, fontSize: 13, flexShrink: 0, maxWidth: '46%' },
  kvV: { color: WO.text, fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },
  kvMono: { fontSize: 11.5, fontWeight: '500', ...Platform.select({ ios: { fontFamily: 'Menlo' }, android: { fontFamily: 'monospace' } }) },

  docRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: WO.line },
  docName: { color: WO.text, fontSize: 13.5, fontWeight: '700' },
  docMeta: { color: WO.textSoft, fontSize: 11.5, marginTop: 1 },

  propGroup: { marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: WO.line },
  propGroupTitle: { fontSize: 11, fontWeight: '800', color: WO.accent, textTransform: 'uppercase', letterSpacing: 0.4, paddingTop: 11, paddingBottom: 2 },

  empty: { color: WO.textSoft, fontSize: 13, paddingVertical: 12 },
  inlineLoad: { paddingVertical: 16, alignItems: 'center' },

  previewWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  previewBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12 },
  previewName: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '700' },
  previewImg: { flex: 1, width: '100%' },
});
