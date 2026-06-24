import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { WO } from '../../theme/wo';
import { ProjectsStackParamList } from '../../navigation/types';
import { qcReportsService, MQualityReport } from '../../services/projects.service';
import { offlineService } from '../../services/offline.service';
import { FormRenderer } from './qc-form/FormRenderer';
import { flattenComponents, isNativelyRenderable, validateForm, initialData } from './qc-form/form-schema';
import { qcDraftStore } from './qc-form/qcDraftStore';
import { NcrLifecyclePanel } from './NcrLifecyclePanel';

type Rt = RouteProp<ProjectsStackParamList, 'QcReportFill'>;
type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'QcReportFill'>;

/**
 * Native QC report fill — renders the Form.io template schema natively (offline
 * tolerant: drafts autosave locally, save/submit queue + replay on reconnect).
 * NCR reports and any schema with unsupported components fall back to the web
 * fill page (which carries the full Form.io renderer + NCR disposition controls).
 */
export function QcReportFillScreen() {
  const route = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const { reportId, title } = route.params;

  const [report, setReport] = useState<(MQualityReport & { templateSchema?: any }) | null>(null);
  const [data, setData] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  useLayoutEffect(() => { navigation.setOptions({ title: title || 'QC Report' }); }, [navigation, title]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await qcReportsService.get(reportId) as MQualityReport & { templateSchema?: any };
        const draft = await qcDraftStore.getDraft(reportId);
        if (!alive) return;
        setReport(r);
        const fields = flattenComponents(r.templateSchema).fields;
        setData(initialData(fields, draft ?? r.data ?? {}));
        setQueued((await qcDraftStore.pendingReportIds()).has(reportId));
      } catch (e: any) {
        if (alive) setError(e?.message || 'Could not load this report.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [reportId]);

  const onChange = useCallback((key: string, value: any) => {
    setData((d) => {
      const next = { ...d, [key]: value };
      qcDraftStore.saveDraft(reportId, next).catch(() => {});
      return next;
    });
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  }, [reportId]);

  const openInBrowser = useCallback(() => {
    navigation.replace('QcReport', { reportId, title });
  }, [navigation, reportId, title]);

  const persist = useCallback(async (status?: 'submitted') => {
    if (!report) return;
    if (status === 'submitted') {
      const { valid, errors: errs } = validateForm(flattenComponents(report.templateSchema).fields, data);
      if (!valid) { setErrors(errs); Alert.alert('Incomplete', 'Please fix the highlighted fields before submitting.'); return; }
    }
    setBusy(status ? 'submit' : 'save'); setError(null);
    try {
      const { synced } = await qcDraftStore.persist(reportId, data, status);
      setQueued(!synced);
      if (status === 'submitted') {
        // Phase 3 will replace this with the course-of-action sheet (next-step routing).
        Alert.alert(
          synced ? 'Report submitted' : 'Saved offline',
          synced ? `${report.number} was submitted.` : `${report.number} will submit automatically when you're back online.`,
          [{ text: 'Done', onPress: () => navigation.goBack() }],
        );
      } else if (!synced) {
        Alert.alert('Saved offline', 'Your draft is saved on this device and will sync when you reconnect.');
      }
    } catch (e: any) {
      setError(e?.message || 'Could not save the report.');
    } finally {
      setBusy(null);
    }
  }, [report, data, reportId, navigation]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  if (error && !report) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={32} color={Colors.medium} />
        <Text style={styles.errTxt}>{error}</Text>
      </View>
    );
  }
  if (!report) return null;

  const isNcr = (report.templateType ?? '') === 'ncr';
  const renderable = isNativelyRenderable(report.templateSchema);
  const hasFields = flattenComponents(report.templateSchema).fields.length > 0;

  // A complex NON-NCR schema we can't render natively → the full web editor.
  if (!isNcr && !renderable) {
    return (
      <View style={styles.center}>
        <Ionicons name="document-text-outline" size={34} color={WO.accent} />
        <Text style={styles.fbTitle}>{report.number}</Text>
        <Text style={styles.fbTxt}>This report uses fields best filled in the full editor.</Text>
        <TouchableOpacity style={styles.fbBtn} onPress={openInBrowser}>
          <Ionicons name="open-outline" size={18} color="#fff" />
          <Text style={styles.fbBtnTxt}>Open full editor</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const submitted = report.status === 'submitted';
  const showForm = renderable && hasFields;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.number}>{report.number}</Text>
          <Text style={styles.tplName} numberOfLines={1}>{report.templateName}{report.itemMark ? `  ·  ${report.itemMark}` : ''}</Text>
          {!isNcr && (
            <View style={styles.badges}>
              <View style={[styles.badge, { backgroundColor: submitted ? WO.goodBg : WO.warnBg }]}>
                <Text style={[styles.badgeTxt, { color: submitted ? WO.good : WO.warn }]}>{submitted ? 'Submitted' : 'Draft'}</Text>
              </View>
              {queued && (
                <View style={[styles.badge, { backgroundColor: WO.muteBg }]}>
                  <Ionicons name="cloud-offline-outline" size={11} color={WO.textSoft} />
                  <Text style={[styles.badgeTxt, { color: WO.textSoft }]}>Queued offline</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {!!error && <Text style={styles.errInline}>{error}</Text>}

        {showForm && (
          <>
            <FormRenderer schema={report.templateSchema} data={data} errors={errors} onChange={onChange} />
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} disabled={!!busy} onPress={() => persist()}>
                {busy === 'save' ? <ActivityIndicator size="small" color={WO.accent} /> : <Text style={styles.btnGhostTxt}>Save draft</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} disabled={!!busy} onPress={() => persist('submitted')}>
                {busy === 'submit' ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnPrimaryTxt}>{submitted ? 'Re-submit' : 'Submit'}</Text>}
              </TouchableOpacity>
            </View>
            {!offlineService.isOnline && <Text style={styles.offlineNote}>You're offline — changes save on this device and sync automatically later.</Text>}
          </>
        )}

        {isNcr && (
          <View style={{ marginTop: showForm ? 22 : 4 }}>
            <NcrLifecyclePanel report={report} onChanged={setReport} />
            {!renderable && (
              <TouchableOpacity style={[styles.fbBtn, { alignSelf: 'flex-start', marginTop: 12 }]} onPress={openInBrowser}>
                <Ionicons name="open-outline" size={16} color="#fff" />
                <Text style={styles.fbBtnTxt}>Edit form fields in full editor</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WO.mist },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10, backgroundColor: WO.mist },
  errTxt: { color: Colors.textSecondary, textAlign: 'center', fontSize: 14 },
  errInline: { color: WO.bad, fontSize: 13, marginBottom: 10, fontWeight: '600' },

  header: { marginBottom: 16 },
  number: { fontSize: 20, fontWeight: '800', color: WO.text },
  tplName: { fontSize: 13, color: WO.textSoft, marginTop: 2 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  badgeTxt: { fontSize: 11, fontWeight: '800' },

  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1, borderColor: WO.accent, backgroundColor: WO.card },
  btnGhostTxt: { color: WO.accent, fontWeight: '800', fontSize: 15 },
  btnPrimary: { backgroundColor: WO.accent },
  btnPrimaryTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  offlineNote: { fontSize: 12, color: WO.textSoft, marginTop: 12, textAlign: 'center' },

  fbTitle: { fontSize: 18, fontWeight: '800', color: WO.text, marginTop: 4 },
  fbTxt: { fontSize: 13.5, color: WO.textSoft, textAlign: 'center', lineHeight: 19, paddingHorizontal: 12 },
  fbBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: WO.accent, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 13, marginTop: 8 },
  fbBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
