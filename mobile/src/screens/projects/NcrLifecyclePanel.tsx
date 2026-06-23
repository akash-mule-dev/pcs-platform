import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { WO } from '../../theme/wo';
import { useAuth } from '../../context/AuthContext';
import { qcReportsService, MQualityReport, MNcrEvent } from '../../services/projects.service';
import { reportStatusMeta, dispositionLabel, QcReportLike } from './qc-reports';

// Mirrors backend ncr-workflow NCR_DISPOSITIONS (value, label, needsConcession).
const DISPOSITIONS: { value: string; label: string; needsConcession: boolean }[] = [
  { value: 'rework', label: 'Rework', needsConcession: false },
  { value: 'repair', label: 'Repair', needsConcession: true },
  { value: 'use_as_is', label: 'Use as-is', needsConcession: true },
  { value: 'scrap', label: 'Scrap', needsConcession: false },
  { value: 'return_to_supplier', label: 'Return to supplier', needsConcession: false },
];
const TONE_COLOR: Record<string, string> = { open: WO.bad, review: WO.warn, disp: WO.info, closed: WO.good, cancelled: WO.textSoft, neutral: WO.textSoft, draft: WO.warn, submitted: WO.good };
const QA_ROLES = ['admin', 'manager', 'supervisor'];

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

interface Props {
  report: MQualityReport;
  onChanged: (updated: MQualityReport) => void;
}

/**
 * Native NCR lifecycle: timeline + comment + the §8.7 Material-Review actions
 * (start-review, disposition w/ concession, close, reopen, cancel). QC-authority
 * actions are role-gated client-side; the backend still enforces
 * `quality-reports.disposition`.
 */
export function NcrLifecyclePanel({ report, onChanged }: Props) {
  const { user } = useAuth();
  const isQa = QA_ROLES.includes((user?.role?.name ?? '').toLowerCase());
  const [events, setEvents] = useState<MNcrEvent[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [dispOpen, setDispOpen] = useState(false);
  const [disp, setDisp] = useState<string>('');
  const [concession, setConcession] = useState('');
  const [notes, setNotes] = useState('');
  const [rootCause, setRootCause] = useState('');

  const status = reportStatusMeta(report as QcReportLike);
  const ncrStatus = report.ncrStatus ?? 'open';
  const closed = ncrStatus === 'closed' || ncrStatus === 'cancelled';
  const needsConcession = !!DISPOSITIONS.find((d) => d.value === disp)?.needsConcession;

  const loadEvents = useCallback(async () => {
    try { setEvents(await qcReportsService.events(report.id)); } catch { setEvents([]); }
  }, [report.id]);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  const run = async (key: string, fn: () => Promise<MQualityReport>, after?: () => void) => {
    if (busy) return;
    setBusy(key);
    try {
      const updated = await fn();
      onChanged(updated);
      after?.();
      await loadEvents();
    } catch (e: any) {
      Alert.alert('NCR', e?.message || 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  const recordDisposition = () => {
    if (!disp) { Alert.alert('Disposition', 'Choose a disposition.'); return; }
    if (needsConcession && !concession.trim()) { Alert.alert('Concession required', `${dispositionLabel(disp)} accepts a deviation — record a concession reason.`); return; }
    run('disp', () => qcReportsService.disposition(report.id, {
      disposition: disp, dispositionNotes: notes.trim() || undefined, rootCause: rootCause.trim() || undefined,
      concessionReason: needsConcession ? concession.trim() : undefined,
    }), () => { setDispOpen(false); });
  };

  const addComment = () => {
    const text = comment.trim();
    if (!text) return;
    setBusy('comment');
    qcReportsService.comment(report.id, text)
      .then(() => { setComment(''); return loadEvents(); })
      .catch((e) => Alert.alert('Comment', e?.message || 'Failed.'))
      .finally(() => setBusy(null));
  };

  return (
    <View>
      {/* Status header */}
      <View style={styles.statusRow}>
        <View style={[styles.statusChip, { backgroundColor: (TONE_COLOR[status.tone] || WO.textSoft) + '22' }]}>
          <View style={[styles.statusDot, { backgroundColor: TONE_COLOR[status.tone] || WO.textSoft }]} />
          <Text style={[styles.statusTxt, { color: TONE_COLOR[status.tone] || WO.textSoft }]}>{status.label}</Text>
        </View>
        {!!report.disposition && <Text style={styles.dispTag}>{dispositionLabel(report.disposition)}</Text>}
      </View>

      {/* Actions (QC authority) */}
      {isQa && !closed && (
        <View style={styles.actions}>
          {ncrStatus === 'open' && (
            <ActionBtn label="Start review" icon="search-outline" busy={busy === 'review'} onPress={() => run('review', () => qcReportsService.startReview(report.id))} />
          )}
          <ActionBtn label={dispOpen ? 'Cancel disposition' : (report.disposition ? 'Revise disposition' : 'Disposition')} icon="construct-outline" onPress={() => setDispOpen((o) => !o)} />
          <ActionBtn label="Close NCR" icon="checkmark-done-outline" tone="good" busy={busy === 'close'} onPress={() => run('close', () => qcReportsService.resolve(report.id))} />
          <ActionBtn label="Cancel NCR" icon="close-circle-outline" tone="bad" busy={busy === 'cancelncr'} onPress={() => run('cancelncr', () => qcReportsService.cancel(report.id))} />
        </View>
      )}
      {isQa && closed && (
        <View style={styles.actions}>
          <ActionBtn label="Reopen" icon="refresh-outline" busy={busy === 'reopen'} onPress={() => run('reopen', () => qcReportsService.reopen(report.id))} />
        </View>
      )}
      {!isQa && !closed && (
        <Text style={styles.hint}>A QC manager dispositions and closes this NCR. You can add comments below.</Text>
      )}

      {/* Disposition form */}
      {dispOpen && (
        <View style={styles.dispBox}>
          <Text style={styles.dispLabel}>Disposition</Text>
          <View style={styles.dispOpts}>
            {DISPOSITIONS.map((d) => (
              <TouchableOpacity key={d.value} style={[styles.dispOpt, disp === d.value && styles.dispOptOn]} onPress={() => setDisp(d.value)}>
                <Text style={[styles.dispOptTxt, disp === d.value && styles.dispOptTxtOn]}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {needsConcession && (
            <TextInput style={styles.input} placeholder="Concession authorization / reason (required)" placeholderTextColor={Colors.textSecondary} value={concession} onChangeText={setConcession} multiline />
          )}
          <TextInput style={styles.input} placeholder="Disposition notes (rework instructions, etc.)" placeholderTextColor={Colors.textSecondary} value={notes} onChangeText={setNotes} multiline />
          <TextInput style={styles.input} placeholder="Root cause (optional)" placeholderTextColor={Colors.textSecondary} value={rootCause} onChangeText={setRootCause} multiline />
          <TouchableOpacity style={styles.dispSave} disabled={busy === 'disp'} onPress={recordDisposition}>
            {busy === 'disp' ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.dispSaveTxt}>Record disposition</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* Comment */}
      <View style={styles.commentRow}>
        <TextInput style={[styles.input, { flex: 1 }]} placeholder="Add a comment…" placeholderTextColor={Colors.textSecondary} value={comment} onChangeText={setComment} />
        <TouchableOpacity style={styles.commentBtn} disabled={busy === 'comment' || !comment.trim()} onPress={addComment}>
          <Ionicons name="send" size={16} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Timeline */}
      <Text style={styles.timelineTitle}>Activity</Text>
      {events === null ? <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 14 }} /> : events.length === 0 ? (
        <Text style={styles.hint}>No activity yet.</Text>
      ) : (
        <View style={styles.timeline}>
          {events.map((e) => (
            <View key={e.id} style={styles.event}>
              <View style={styles.eventDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.eventMain}>
                  <Text style={{ fontWeight: '800' }}>{e.createdByName || 'System'}</Text>{' '}
                  {eventText(e)}
                </Text>
                <Text style={styles.eventTime}>{fmt(e.createdAt)}</Text>
                {!!e.note && <Text style={styles.eventNote}>{e.note}</Text>}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function eventText(e: MNcrEvent): string {
  switch (e.type) {
    case 'created': return 'raised this NCR';
    case 'submitted': return 'submitted the report';
    case 'disposition': return `dispositioned: ${dispositionLabel(e.disposition)}`;
    case 'resolved': return 'closed the NCR';
    case 'reopened': return 'reopened the NCR';
    case 'cancelled': return 'cancelled the NCR';
    case 'linked': return 'linked a failed inspection';
    case 'comment': return 'commented';
    case 'status': return `moved to ${e.toStatus ?? '—'}`;
    default: return e.type;
  }
}

function ActionBtn({ label, icon, onPress, busy, tone }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; busy?: boolean; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? WO.good : tone === 'bad' ? WO.bad : WO.accent;
  return (
    <TouchableOpacity style={[styles.actBtn, { borderColor: color }]} disabled={busy} onPress={onPress}>
      {busy ? <ActivityIndicator size="small" color={color} /> : (<><Ionicons name={icon} size={15} color={color} /><Text style={[styles.actTxt, { color }]}>{label}</Text></>)}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusTxt: { fontSize: 12.5, fontWeight: '800' },
  dispTag: { fontSize: 12, fontWeight: '700', color: WO.info, backgroundColor: WO.infoBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  actBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: WO.card },
  actTxt: { fontWeight: '800', fontSize: 12.5 },
  hint: { fontSize: 12.5, color: WO.textSoft, marginBottom: 10, lineHeight: 18 },

  dispBox: { backgroundColor: WO.card, borderRadius: 12, borderWidth: 1, borderColor: WO.line, padding: 12, marginBottom: 12, gap: 9 },
  dispLabel: { fontSize: 12, fontWeight: '800', color: WO.textSoft, textTransform: 'uppercase', letterSpacing: 0.4 },
  dispOpts: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  dispOpt: { borderWidth: 1, borderColor: WO.line, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 7 },
  dispOptOn: { borderColor: WO.accent, backgroundColor: WO.infoBg },
  dispOptTxt: { fontSize: 12.5, color: WO.text, fontWeight: '600' },
  dispOptTxtOn: { color: WO.accent, fontWeight: '800' },
  input: { backgroundColor: WO.mist, borderRadius: 9, borderWidth: 1, borderColor: WO.line, paddingHorizontal: 11, paddingVertical: 9, fontSize: 14, color: WO.text },
  dispSave: { backgroundColor: WO.accent, borderRadius: 9, paddingVertical: 11, alignItems: 'center' },
  dispSaveTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },

  commentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  commentBtn: { width: 42, height: 42, borderRadius: 9, backgroundColor: WO.accent, alignItems: 'center', justifyContent: 'center' },

  timelineTitle: { fontSize: 12, fontWeight: '800', color: WO.textSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  timeline: { gap: 12 },
  event: { flexDirection: 'row', gap: 10 },
  eventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: WO.accent, marginTop: 5 },
  eventMain: { fontSize: 13, color: WO.text },
  eventTime: { fontSize: 11, color: WO.textSoft, marginTop: 1 },
  eventNote: { fontSize: 12.5, color: WO.textSoft, marginTop: 3, fontStyle: 'italic' },
});
