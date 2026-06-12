import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { StatusBadge } from '../../components/StatusBadge';
import { ncrService, Ncr, NcrEvent } from '../../services/factory.service';
import { can } from '../../config/permissions';
import { MoreStackParamList } from '../../navigation/types';

const DISPOSITIONS = ['rework', 'scrap', 'use_as_is', 'return_to_supplier', 'regrade'];
const VERBS: Record<string, string> = {
  investigation: 'Start investigation',
  disposition: 'Move to disposition',
  closed: 'Close NCR',
  cancelled: 'Cancel NCR',
};
const EVENT_GLYPH: Record<NcrEvent['type'], string> = {
  created: '⚑', status_change: '→', disposition: '⚖', assignment: '👤', comment: '💬',
};

export function NcrDetailScreen() {
  const route = useRoute<RouteProp<MoreStackParamList, 'NcrDetail'>>();
  const { id } = route.params;
  const [ncr, setNcr] = useState<Ncr | null>(null);
  const [events, setEvents] = useState<NcrEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [pickDisposition, setPickDisposition] = useState(false);
  const canManage = can('ncr.manage');
  const canComment = can('ncr.create');

  const load = useCallback(async () => {
    try {
      const [n, ev] = await Promise.all([ncrService.getOne(id), ncrService.events(id).catch(() => [])]);
      setNcr(n);
      setEvents(ev);
    } catch {
      /* keep last data */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const transition = async (to: string) => {
    if (!ncr) return;
    // Closing needs a disposition — offer the picker when one isn't recorded yet.
    if (to === 'closed' && !ncr.disposition) {
      setPickDisposition(true);
      return;
    }
    setBusy(true);
    try {
      await ncrService.update(ncr.id, { status: to });
      await load();
    } catch (e: any) {
      Alert.alert('Not allowed', e?.message || 'Transition failed');
    } finally {
      setBusy(false);
    }
  };

  const closeWith = async (disposition: string) => {
    if (!ncr) return;
    setPickDisposition(false);
    setBusy(true);
    try {
      await ncrService.update(ncr.id, { status: 'closed', disposition });
      await load();
    } catch (e: any) {
      Alert.alert('Not allowed', e?.message || 'Close failed');
    } finally {
      setBusy(false);
    }
  };

  const sendComment = async () => {
    const note = comment.trim();
    if (!ncr || !note) return;
    setBusy(true);
    try {
      await ncrService.addComment(ncr.id, note);
      setComment('');
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Comment failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  if (!ncr) return <View style={styles.center}><Text style={styles.muted}>NCR not found.</Text></View>;

  const transitions = ncr.allowedTransitions ?? [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <View style={styles.headerRow}>
        <Text style={styles.number}>{ncr.number}</Text>
        <StatusBadge status={ncr.status} />
      </View>
      <Text style={styles.title}>{ncr.title}</Text>
      {(ncr.projectName || ncr.itemMark) ? (
        <Text style={styles.context}>
          {ncr.projectName ?? ''}{ncr.projectName && ncr.itemMark ? ' · ' : ''}{ncr.itemMark ?? ''}
        </Text>
      ) : null}

      {!!ncr.severity && (
        <View style={styles.row}><Text style={styles.k}>Severity</Text><StatusBadge status={ncr.severity} small /></View>
      )}
      {!!ncr.disposition && (
        <View style={styles.row}>
          <Text style={styles.k}>Disposition</Text>
          <Text style={styles.v}>{ncr.disposition.replace(/_/g, ' ')}{ncr.dispositionNote ? ` — ${ncr.dispositionNote}` : ''}</Text>
        </View>
      )}
      {!!ncr.description && (
        <>
          <Text style={styles.sectionLabel}>Details</Text>
          <Text style={styles.body}>{ncr.description}</Text>
        </>
      )}

      {/* Guided workflow actions */}
      {canManage && transitions.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Actions</Text>
          <View style={styles.actionsRow}>
            {transitions.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.actionBtn, t === 'closed' && styles.actionPrimary, t === 'cancelled' && styles.actionDanger]}
                disabled={busy}
                onPress={() => transition(t)}
              >
                <Text style={[styles.actionText, (t === 'closed' || t === 'cancelled') && styles.actionTextLight]}>
                  {VERBS[t] ?? (ncr.status === 'closed' ? 'Reopen' : t)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* Disposition picker (shown when closing without one) */}
      {pickDisposition && (
        <View style={styles.dispoSheet}>
          <Text style={styles.dispoTitle}>Select a disposition to close</Text>
          {DISPOSITIONS.map((d) => (
            <TouchableOpacity key={d} style={styles.dispoOption} disabled={busy} onPress={() => closeWith(d)}>
              <Text style={styles.dispoText}>{d.replace(/_/g, ' ')}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.dispoCancel} onPress={() => setPickDisposition(false)}>
            <Text style={styles.muted}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Timeline */}
      <Text style={styles.sectionLabel}>Timeline</Text>
      {events.length === 0 ? (
        <Text style={styles.muted}>No activity yet.</Text>
      ) : (
        events.map((e) => (
          <View key={e.id} style={styles.event}>
            <Text style={styles.eventGlyph}>{EVENT_GLYPH[e.type] ?? '•'}</Text>
            <View style={styles.eventBody}>
              <Text style={[styles.eventLine, e.type === 'status_change' && styles.cap]}>
                {e.type === 'created' && 'Raised'}
                {e.type === 'status_change' && `${e.fromStatus ?? ''} → ${e.toStatus ?? ''}`}
                {e.type === 'disposition' && `Disposition: ${e.note ?? ''}`}
                {(e.type === 'assignment' || e.type === 'comment') && (e.note ?? '')}
              </Text>
              <Text style={styles.eventMeta}>
                {(e.actorName || 'system')} · {e.createdAt ? new Date(e.createdAt).toLocaleString() : ''}
              </Text>
            </View>
          </View>
        ))
      )}

      {/* Comment box */}
      {canComment && (
        <View style={styles.commentRow}>
          <TextInput
            style={styles.commentInput}
            placeholder="Add a comment…"
            placeholderTextColor={Colors.textSecondary}
            value={comment}
            onChangeText={setComment}
            editable={!busy}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!comment.trim() || busy) && styles.sendBtnDisabled]}
            disabled={!comment.trim() || busy}
            onPress={sendComment}
          >
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  muted: { color: Colors.textSecondary, fontSize: 14 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  number: { fontSize: 18, fontWeight: '700', color: Colors.text },
  title: { fontSize: 16, color: Colors.text, marginBottom: 4 },
  context: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  k: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  v: { fontSize: 14, color: Colors.text, textTransform: 'capitalize', flexShrink: 1, textAlign: 'right' },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginTop: 18, marginBottom: 6 },
  body: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 14, backgroundColor: Colors.card ?? '#fff' },
  actionPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  actionDanger: { backgroundColor: Colors.danger ?? '#dc2626', borderColor: Colors.danger ?? '#dc2626' },
  actionText: { fontSize: 13.5, fontWeight: '600', color: Colors.text },
  actionTextLight: { color: '#fff' },
  dispoSheet: { marginTop: 12, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, backgroundColor: Colors.card ?? '#fff' },
  dispoTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  dispoOption: { paddingVertical: 11, borderTopWidth: 1, borderTopColor: Colors.border },
  dispoText: { fontSize: 14, color: Colors.text, textTransform: 'capitalize' },
  dispoCancel: { paddingTop: 12, alignItems: 'center' },
  event: { flexDirection: 'row', gap: 8, paddingVertical: 6 },
  eventGlyph: { width: 22, fontSize: 13, textAlign: 'center', color: Colors.textSecondary },
  eventBody: { flex: 1 },
  eventLine: { fontSize: 13.5, color: Colors.text },
  cap: { textTransform: 'capitalize' },
  eventMeta: { fontSize: 11.5, color: Colors.textSecondary, marginTop: 1 },
  commentRow: { flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'center' },
  commentInput: { flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, color: Colors.text, backgroundColor: Colors.card ?? '#fff', fontSize: 14 },
  sendBtn: { backgroundColor: Colors.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 13.5 },
});
