import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  ActivityIndicator, Alert, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { WO } from '../../theme/wo';
import { qcReportsService, MQualityReport, MTemplate } from '../../services/projects.service';
import { authService } from '../../services/auth.service';
import { environment } from '../../config/environment';
import {
  splitNodeReports, groupTemplatesByType, reportStatusMeta, severityOf,
  dispositionLabel, isNcr, isOpenNcr, templateTypeMeta, Tone, QcReportLike, TemplateLike,
} from './qc-reports';

interface Props {
  visible: boolean;
  onClose: () => void;
  orderId: string;
  nodeId: string;
  mark: string;
  /** Parent closes the sheet and navigates to the in-app fill screen. */
  onOpenReport: (reportId: string, title: string) => void;
}

// Status chip tones → theme colors.
const TONE_COLORS: Record<Tone, { fg: string; bg: string }> = {
  open: { fg: WO.bad, bg: WO.badBg },
  review: { fg: WO.warn, bg: WO.warnBg },
  disp: { fg: WO.info, bg: WO.infoBg },
  closed: { fg: WO.good, bg: WO.goodBg },
  submitted: { fg: WO.good, bg: WO.goodBg },
  draft: { fg: WO.warn, bg: WO.warnBg },
  cancelled: { fg: WO.textSoft, bg: WO.muteBg },
  neutral: { fg: WO.textSoft, bg: WO.muteBg },
};

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Chip({ tone, label }: { tone: Tone; label: string }) {
  const c = TONE_COLORS[tone] ?? TONE_COLORS.neutral;
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={[styles.chipTxt, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

/**
 * Per-assembly QC dossier + launcher. Lists the reports & NCRs already raised
 * against this piece (open items needing action surfaced first, then the
 * history) with live status/severity, and a grouped "start a new report"
 * creator. Tapping any report opens the in-app fill page (the existing
 * WebView over /qr/:id); a small icon opens it in the device browser instead.
 */
export function QcReportsSheet({ visible, onClose, orderId, nodeId, mark, onOpenReport }: Props) {
  const [reports, setReports] = useState<MQualityReport[] | null>(null);
  const [templates, setTemplates] = useState<MTemplate[] | null>(null);
  const [busyTemplate, setBusyTemplate] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Reports change as they're created/worked — reload every time the sheet opens,
  // and always land on the dossier-first view (collapse any expanded creator).
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setReports(null);
    setCreateOpen(false);
    qcReportsService.listByOrder(orderId)
      .then((rs) => { if (alive) setReports(rs); })
      .catch(() => { if (alive) setReports([]); });
    return () => { alive = false; };
  }, [visible, orderId, nodeId]);

  // Templates are stable, so fetch once — but `null` means "not loaded yet", so a
  // transient failure (kept null) is retried the next time the sheet opens.
  useEffect(() => {
    if (!visible || templates !== null) return;
    let alive = true;
    qcReportsService.templates()
      .then((t) => { if (alive) setTemplates(t); })
      .catch(() => { if (alive) setTemplates(null); });
    return () => { alive = false; };
  }, [visible, templates]);

  const { attention, history } = useMemo(
    () => splitNodeReports(reports as QcReportLike[] | null, nodeId),
    [reports, nodeId],
  );
  const templateGroups = useMemo(() => groupTemplatesByType(templates), [templates]);
  const total = attention.length + history.length;
  const openNcrCount = attention.filter((r) => isOpenNcr(r)).length;
  const draftCount = attention.length - openNcrCount; // attention = open NCRs + unfinished drafts
  // Drafts are routine WIP; only an open NCR is alarming. Colour/label accordingly.
  const attnLabel = openNcrCount > 0 ? 'Needs attention' : 'In progress';
  const attnColor = openNcrCount > 0 ? WO.bad : WO.warn;
  const summaryDot = openNcrCount > 0 ? WO.bad : draftCount > 0 ? WO.warn : WO.good;
  const summaryParts: string[] = [`${total} report${total === 1 ? '' : 's'}`];
  if (openNcrCount > 0) summaryParts.push(`${openNcrCount} open NCR${openNcrCount === 1 ? '' : 's'}`);
  if (draftCount > 0) summaryParts.push(`${draftCount} draft${draftCount === 1 ? '' : 's'}`);
  if (openNcrCount === 0 && draftCount === 0) summaryParts.push('all submitted');

  // No reports yet → lead with the creator so the next tap starts one.
  const showCreate = createOpen || total === 0;

  const openInApp = useCallback((r: QcReportLike) => onOpenReport(r.id, r.number), [onOpenReport]);

  const openInBrowser = useCallback(async (id: string) => {
    try {
      const token = (await authService.getToken()) ?? '';
      await Linking.openURL(`${environment.webUrl}/qr/${id}?token=${encodeURIComponent(token)}`);
    } catch {
      Alert.alert('QC report', 'Could not open the report in the browser.');
    }
  }, []);

  const createAndOpen = useCallback(async (t: TemplateLike) => {
    if (busyTemplate) return;
    setBusyTemplate(t.id);
    try {
      const r = await qcReportsService.create({ templateId: t.id, productionOrderId: orderId, assemblyNodeId: nodeId });
      onOpenReport(r.id, r.number);
    } catch {
      Alert.alert('QC report', 'Could not start the report.');
    } finally {
      setBusyTemplate(null);
    }
  }, [busyTemplate, orderId, nodeId, onOpenReport]);

  const renderReport = (r: QcReportLike) => {
    const meta = templateTypeMeta(r.templateType);
    const status = reportStatusMeta(r);
    const sev = severityOf(r);
    const disp = dispositionLabel(r.disposition);
    const ncr = isNcr(r);
    return (
      <TouchableOpacity key={r.id} style={styles.reportRow} onPress={() => openInApp(r)} activeOpacity={0.7}>
        <Ionicons name={meta.icon as any} size={20} color={ncr ? WO.bad : WO.accent} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.reportTop}>
            <Text style={styles.reportNum} numberOfLines={1}>{r.number}</Text>
            <Chip tone={status.tone} label={status.label} />
            {!!sev && <Chip tone="neutral" label={sev} />}
          </View>
          <Text style={styles.reportName} numberOfLines={1}>
            {r.templateName || meta.label}{disp ? ` · ${disp}` : ''}
          </Text>
          <Text style={styles.reportMeta} numberOfLines={1}>
            {[r.templateType ? meta.label : null, r.filledByName, fmtDate(r.createdAt)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => openInBrowser(r.id)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 8 }}
          style={styles.browserBtn}
        >
          <Ionicons name="open-outline" size={17} color={Colors.textSecondary} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>QC reports</Text>
              <Text style={styles.sub} numberOfLines={1}>{mark}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Summary strip */}
          {reports !== null && total > 0 && (
            <View style={styles.summary}>
              <View style={[styles.summaryDot, { backgroundColor: summaryDot }]} />
              <Text style={styles.summaryTxt}>{summaryParts.join(' · ')}</Text>
            </View>
          )}

          <ScrollView style={{ marginTop: 6 }} contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
            {reports === null ? (
              <View style={styles.inlineLoad}><ActivityIndicator color={Colors.primary} /></View>
            ) : (
              <>
                {attention.length > 0 && (
                  <>
                    <Text style={[styles.sectionTitle, { color: attnColor }]}>{attnLabel}</Text>
                    <View style={styles.card}>{attention.map(renderReport)}</View>
                  </>
                )}

                {history.length > 0 && (
                  <>
                    <Text style={styles.sectionTitle}>History</Text>
                    <View style={styles.card}>{history.map(renderReport)}</View>
                  </>
                )}

                {total === 0 && (
                  <View style={styles.emptyBox}>
                    <Ionicons name="document-text-outline" size={30} color={WO.textSoft} />
                    <Text style={styles.emptyTitle}>No QC reports yet</Text>
                    <Text style={styles.emptyTxt}>Start an inspection or raise a non-conformance for this piece below.</Text>
                  </View>
                )}
              </>
            )}

            {/* Create */}
            {total > 0 && !createOpen && (
              <TouchableOpacity style={styles.newBtn} onPress={() => setCreateOpen(true)} activeOpacity={0.8}>
                <Ionicons name="add-circle" size={18} color={WO.accent} />
                <Text style={styles.newBtnTxt}>Start a new report</Text>
              </TouchableOpacity>
            )}

            {showCreate && (
              <View style={styles.createSection}>
                <Text style={styles.sectionTitle}>Start a new report</Text>
                {templates === null ? (
                  <View style={styles.inlineLoad}><ActivityIndicator size="small" color={Colors.primary} /></View>
                ) : templateGroups.length === 0 ? (
                  <Text style={styles.emptyTxt}>No templates yet — create one in the web portal.</Text>
                ) : (
                  templateGroups.map((g) => (
                    <View key={g.type} style={styles.tplGroup}>
                      <View style={styles.tplGroupHead}>
                        <Ionicons name={g.icon as any} size={14} color={g.tone === 'ncr' ? WO.bad : g.tone === 'inspection' ? WO.good : WO.textSoft} />
                        <Text style={styles.tplGroupTitle}>{g.label}</Text>
                      </View>
                      {g.items.map((t) => (
                        <TouchableOpacity
                          key={t.id}
                          style={styles.tplRow}
                          onPress={() => createAndOpen(t)}
                          disabled={!!busyTemplate}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.tplName} numberOfLines={1}>{t.name}</Text>
                          {busyTemplate === t.id
                            ? <ActivityIndicator size="small" color={Colors.primary} />
                            : <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />}
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: WO.mist, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingTop: 16, maxHeight: '88%' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 20, fontWeight: '800', color: WO.text, letterSpacing: 0.2 },
  sub: { fontSize: 13, color: WO.textSoft, marginTop: 1 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: WO.muteBg, alignItems: 'center', justifyContent: 'center' },

  summary: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: WO.card, borderRadius: 10, borderWidth: 1, borderColor: WO.line, paddingHorizontal: 12, paddingVertical: 9 },
  summaryDot: { width: 9, height: 9, borderRadius: 5 },
  summaryTxt: { fontSize: 13, fontWeight: '700', color: WO.text },

  sectionTitle: { fontSize: 12, fontWeight: '800', color: WO.textSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 7 },
  card: { backgroundColor: WO.card, borderRadius: 12, borderWidth: 1, borderColor: WO.line, paddingHorizontal: 12 },

  reportRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: WO.line },
  reportTop: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  reportNum: { fontSize: 14, fontWeight: '800', color: WO.text },
  reportName: { fontSize: 13, fontWeight: '600', color: WO.text, marginTop: 2 },
  reportMeta: { fontSize: 11.5, color: WO.textSoft, marginTop: 1 },
  browserBtn: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: WO.muteBg },

  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipTxt: { fontSize: 10.5, fontWeight: '800', textTransform: 'capitalize' },

  emptyBox: { alignItems: 'center', gap: 6, paddingVertical: 22, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: WO.text },
  emptyTxt: { fontSize: 13, color: WO.textSoft, textAlign: 'center', lineHeight: 18 },

  newBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 16, backgroundColor: WO.card, borderRadius: 12, borderWidth: 1, borderColor: WO.accent, paddingVertical: 13 },
  newBtnTxt: { fontSize: 14, fontWeight: '800', color: WO.accent },

  createSection: { marginTop: 4 },
  tplGroup: { marginTop: 8, backgroundColor: WO.card, borderRadius: 12, borderWidth: 1, borderColor: WO.line, paddingHorizontal: 12, paddingBottom: 2 },
  tplGroupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 11, paddingBottom: 4 },
  tplGroupTitle: { fontSize: 11, fontWeight: '800', color: WO.textSoft, textTransform: 'uppercase', letterSpacing: 0.4 },
  tplRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: WO.line },
  tplName: { flex: 1, fontSize: 14, fontWeight: '600', color: WO.text },

  inlineLoad: { paddingVertical: 22, alignItems: 'center' },
});
