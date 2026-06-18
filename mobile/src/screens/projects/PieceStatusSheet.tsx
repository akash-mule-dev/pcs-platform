import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { WO, SHIP_META, STAGE_COLORS, STAGE_LABELS } from '../../theme/wo';
import { ordersService, MNodeAudit, MAuditStageRow } from '../../services/projects.service';

/** Identity facts shown instantly (before the live status resolves). */
export interface PieceFacts {
  mark?: string | null;
  name?: string | null;
  nodeType?: string | null;
  profile?: string | null;
  materialGrade?: string | null;
  lengthMm?: number | null;
  weightKg?: number | null;
}

interface ResolvedOrder { id: string; number: string; status: string; customerName: string | null; quantity: number }

function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Tap-a-piece live production status card. Given a node, resolves which
 * production orders build it (`resolveNode`) and, for the chosen order, its
 * current stage / who+where / ship status / open NCRs (`nodeAudit`) — the
 * spatial twin of the QR-scan resolve flow. Reusable from the 3D viewer (mesh
 * tap) and the assembly tree (row tap).
 */
export function PieceStatusSheet({
  visible,
  onClose,
  nodeId,
  facts,
  ancestorIds,
  onOpenAssembly,
}: {
  visible: boolean;
  onClose: () => void;
  nodeId: string | null;
  facts?: PieceFacts | null;
  /**
   * Nearest-first ancestor node ids. Production is tracked per assembly, so a
   * tapped part often has no work order of its own — we fall back to the nearest
   * ancestor that does, while keeping the tapped piece's identity in the header.
   */
  ancestorIds?: string[];
  /** Open the full assembly work screen for an order. */
  onOpenAssembly?: (orderId: string, nodeId: string, mark: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<ResolvedOrder[]>([]);
  const [resolved, setResolved] = useState<{ mark: string; name: string; nodeType: string } | null>(null);
  const [statusNodeId, setStatusNodeId] = useState<string | null>(null);
  const [statusMark, setStatusMark] = useState<string>('');
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [selOrderId, setSelOrderId] = useState<string | null>(null);
  const [audit, setAudit] = useState<MNodeAudit | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the node → its production orders whenever the sheet opens on a node.
  // Walk self → ancestors until one actually has orders (work orders are
  // per-assembly), keeping the tapped piece as the header identity.
  useEffect(() => {
    if (!visible || !nodeId) return;
    let alive = true;
    setLoading(true); setError(null); setAudit(null); setOrders([]); setResolved(null);
    setSelOrderId(null); setStatusNodeId(null); setStatusMark(''); setFallbackUsed(false);
    const candidates = [nodeId, ...(ancestorIds ?? [])].slice(0, 6);
    (async () => {
      let tapped: { id: string; mark: string; name: string; nodeType: string } | null = null;
      let chosen: { id: string; mark: string; orders: ResolvedOrder[] } | null = null;
      for (const cid of candidates) {
        try {
          const r = await ordersService.resolveNode(cid);
          if (!alive) return;
          if (!tapped) tapped = { id: cid, mark: r.node.mark, name: r.node.name, nodeType: r.node.nodeType };
          if (r.orders && r.orders.length) { chosen = { id: cid, mark: r.node.mark, orders: r.orders }; break; }
        } catch { /* try the next ancestor */ }
        if (!alive) return;
      }
      if (!alive) return;
      if (!tapped && !chosen) { setError('Could not load this piece.'); setLoading(false); return; }
      if (tapped) setResolved({ mark: tapped.mark, name: tapped.name, nodeType: tapped.nodeType });
      const statusId = chosen?.id ?? tapped?.id ?? nodeId;
      setStatusNodeId(statusId);
      setStatusMark(chosen?.mark ?? tapped?.mark ?? '');
      setFallbackUsed(!!chosen && chosen.id !== nodeId);
      setOrders(chosen?.orders ?? []);
      setSelOrderId(chosen?.orders?.[0]?.id ?? null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [visible, nodeId, ancestorIds]);

  // Load the per-order audit for the selected order (keyed to the status node).
  useEffect(() => {
    if (!visible || !statusNodeId || !selOrderId) { setAudit(null); return; }
    let alive = true;
    setAuditLoading(true);
    ordersService.nodeAudit(selOrderId, statusNodeId)
      .then((a) => { if (alive) setAudit(a); })
      .catch(() => { if (alive) setAudit(null); })
      .finally(() => { if (alive) setAuditLoading(false); });
    return () => { alive = false; };
  }, [visible, statusNodeId, selOrderId]);

  const mark = resolved?.mark || facts?.mark || 'Piece';
  const nodeType = resolved?.nodeType || facts?.nodeType || '';

  const factRows = useMemo(() => {
    const out: { k: string; v: string }[] = [];
    if (facts?.name && facts.name !== mark) out.push({ k: 'Name', v: facts.name });
    if (facts?.profile) out.push({ k: 'Profile', v: facts.profile });
    if (facts?.materialGrade) out.push({ k: 'Grade', v: facts.materialGrade });
    if (facts?.lengthMm) out.push({ k: 'Length', v: `${Math.round(facts.lengthMm)} mm` });
    if (facts?.weightKg) out.push({ k: 'Weight', v: `${Math.round(facts.weightKg * 10) / 10} kg` });
    return out;
  }, [facts, mark]);

  const curStage: MAuditStageRow | null = useMemo(() => {
    const s = audit?.stages ?? [];
    return s.find((x) => x.status === 'in_progress') ?? s.find((x) => x.status === 'pending') ?? s[s.length - 1] ?? null;
  }, [audit]);

  const openNcrs = (audit?.ncrs ?? []).filter((n) => n.status === 'open').length;
  const ship = audit ? SHIP_META[audit.shipStatus] : null;

  const openWork = useCallback(() => {
    if (!statusNodeId || !selOrderId) return;
    onClose();
    onOpenAssembly?.(selOrderId, statusNodeId, statusMark || mark);
  }, [statusNodeId, selOrderId, statusMark, mark, onOpenAssembly, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.mark} numberOfLines={1}>{mark}</Text>
              {!!nodeType && <Text style={styles.sub}>{nodeType}</Text>}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Identity facts */}
          {factRows.length > 0 && (
            <View style={styles.facts}>
              {factRows.map((f) => (
                <View key={f.k} style={styles.fact}>
                  <Text style={styles.factK}>{f.k}</Text>
                  <Text style={styles.factV} numberOfLines={1}>{f.v}</Text>
                </View>
              ))}
            </View>
          )}

          {loading ? (
            <View style={styles.center}><ActivityIndicator color={Colors.primary} /><Text style={styles.muted}>Resolving production status…</Text></View>
          ) : error ? (
            <Text style={styles.err}>{error}</Text>
          ) : orders.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="cube-outline" size={26} color={Colors.medium} />
              <Text style={styles.muted}>Not in any production order yet — this is a design item.</Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {fallbackUsed && (
                <View style={styles.noteRow}>
                  <Ionicons name="git-branch-outline" size={13} color={Colors.textSecondary} />
                  <Text style={styles.noteTxt}>Production tracked at assembly {statusMark}</Text>
                </View>
              )}

              {/* Order picker (when the design backs more than one run) */}
              {orders.length > 1 && (
                <>
                  <Text style={styles.label}>Production order ({orders.length})</Text>
                  <View style={styles.chips}>
                    {orders.map((o) => {
                      const on = o.id === selOrderId;
                      return (
                        <TouchableOpacity key={o.id} style={[styles.chip, on && styles.chipOn]} onPress={() => setSelOrderId(o.id)}>
                          <Text style={[styles.chipTxt, on && styles.chipTxtOn]} numberOfLines={1}>
                            {o.number}{o.customerName ? ` · ${o.customerName}` : ''}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {auditLoading ? (
                <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
              ) : audit ? (
                <>
                  {/* Status + progress */}
                  <View style={styles.statusRow}>
                    <View style={[styles.statusChip, { backgroundColor: audit.status === 'completed' ? WO.good : audit.status === 'in_progress' ? '#f9a825' : Colors.medium }]}>
                      <Text style={styles.statusChipTxt}>
                        {audit.status === 'completed' ? 'Completed' : audit.status === 'in_progress' ? 'In progress' : 'Not started'}
                      </Text>
                    </View>
                    {ship && (
                      <View style={[styles.shipChip, { backgroundColor: ship.bg }]}>
                        <Ionicons name={ship.icon as any} size={12} color={ship.fg} />
                        <Text style={[styles.shipTxt, { color: ship.fg }]}>
                          {audit.shipStatus === 'ready' ? `Ready · ${audit.shipReadyQty}` : ship.label}
                        </Text>
                      </View>
                    )}
                    {openNcrs > 0 && (
                      <View style={[styles.shipChip, { backgroundColor: WO.badBg }]}>
                        <Ionicons name="alert-circle" size={12} color={WO.bad} />
                        <Text style={[styles.shipTxt, { color: WO.bad }]}>{openNcrs} open NCR</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.min(100, Math.round(audit.percentComplete))}%` as any }, audit.percentComplete >= 100 && { backgroundColor: WO.good }]} />
                  </View>
                  <Text style={styles.pct}>{Math.round(audit.percentComplete)}% complete · {audit.unitsDone}/{audit.unitsTotal} units</Text>

                  {/* Current stage / who / where */}
                  {curStage && (
                    <View style={styles.stageBox}>
                      <View style={styles.stageHead}>
                        <View style={[styles.dot, { backgroundColor: STAGE_COLORS[curStage.status] || Colors.medium }]} />
                        <Text style={styles.stageName} numberOfLines={1}>{curStage.name}</Text>
                        {curStage.gateBlocked && <Ionicons name="lock-closed" size={13} color={WO.warn} />}
                        <View style={{ flex: 1 }} />
                        <Text style={styles.stageQty}>{curStage.qtyDone}/{curStage.qtyTotal}</Text>
                      </View>
                      <Text style={styles.stageMeta}>
                        {STAGE_LABELS[curStage.status] || curStage.status}
                        {curStage.assignedUser ? ` · ${curStage.assignedUser.name}` : ''}
                        {curStage.station ? ` @ ${curStage.station.name}` : ''}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.lastAct}>{audit.workOrderNumber} · last activity {fmtStamp(audit.events?.[0]?.at)}</Text>

                  <TouchableOpacity style={styles.openBtn} onPress={openWork}>
                    <Ionicons name="open-outline" size={16} color={Colors.white} />
                    <Text style={styles.openTxt}>Open work screen</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={styles.muted}>Could not load status for this order.</Text>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 26 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { fontSize: 20, fontWeight: '800', color: Colors.text },
  sub: { fontSize: 12, color: Colors.textSecondary, textTransform: 'capitalize', marginTop: 1 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  fact: { backgroundColor: WO.muteBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  factK: { fontSize: 9.5, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3 },
  factV: { fontSize: 13, fontWeight: '700', color: Colors.text, marginTop: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 24 },
  muted: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center' },
  err: { color: Colors.danger, fontSize: 13, paddingVertical: 16, textAlign: 'center' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  noteTxt: { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic' },
  label: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: Colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: Colors.white, maxWidth: '100%' },
  chipOn: { borderColor: Colors.primary, backgroundColor: '#e8f0fe' },
  chipTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: 12.5 },
  chipTxtOn: { color: Colors.primary },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 16 },
  statusChip: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: 999 },
  statusChipTxt: { color: Colors.white, fontSize: 11.5, fontWeight: '700' },
  shipChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  shipTxt: { fontSize: 11.5, fontWeight: '700' },
  track: { height: 8, backgroundColor: Colors.light, borderRadius: 5, overflow: 'hidden', marginTop: 14 },
  fill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 5 },
  pct: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600', marginTop: 6 },
  stageBox: { backgroundColor: WO.mist, borderRadius: 10, padding: 12, marginTop: 14 },
  stageHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  stageName: { fontSize: 14, fontWeight: '700', color: Colors.text, flexShrink: 1 },
  stageQty: { fontSize: 13, fontWeight: '800', color: Colors.text },
  stageMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 6 },
  lastAct: { fontSize: 11.5, color: Colors.textSecondary, marginTop: 12 },
  openBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, marginTop: 14 },
  openTxt: { color: Colors.white, fontWeight: '700', fontSize: 14 },
});
