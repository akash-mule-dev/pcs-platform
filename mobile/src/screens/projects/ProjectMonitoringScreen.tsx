import React, { useCallback, useLayoutEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService, MImport, MImportDetail } from '../../services/projects.service';
import { can } from '../../config/permissions';
import { useProjectImports } from '../../hooks/useProjectImports';
import { PipelineStepper, ProgressBar, ImportStatusChip } from './ImportPipelineView';
import { pickImportFile } from './pickImportFile';
import { fmtBytes, fmtDuration, fmtRelTime } from './monitor-format';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectMonitoring'>;
type Rt = RouteProp<ProjectsStackParamList, 'ProjectMonitoring'>;

/** Live import-pipeline monitor for a single project: in-flight steppers + full history. */
export function ProjectMonitoringScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { projectId, name, notice } = route.params;
  const { imports, activeImports, loading, refresh } = useProjectImports(projectId);

  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  // Seed from the route (e.g. an upload that failed right after project creation).
  const [banner, setBanner] = useState<string | null>(notice ?? null);
  const canUpload = can('projects.import');

  const upload = useCallback(async () => {
    setBanner(null);
    let file;
    try {
      file = await pickImportFile();
    } catch (e: any) {
      setBanner(e?.message || 'Could not read that file.');
      return;
    }
    if (!file) return;
    setUploading(true);
    setUploadPct(0);
    try {
      await projectsService.importIfc(projectId, file, setUploadPct);
      await refresh();
    } catch (e: any) {
      setBanner(e?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }, [projectId, refresh]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: name ? `${name} · Monitoring` : 'Monitoring',
      headerRight: () =>
        canUpload ? (
          <TouchableOpacity style={styles.headBtn} onPress={upload} disabled={uploading} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="cloud-upload-outline" size={18} color={Colors.primary} />
            <Text style={styles.headBtnTxt}>Upload</Text>
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation, name, upload, uploading, canUpload]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  if (loading && imports.length === 0) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      {!!banner && (
        <View style={styles.banner}><Text style={styles.bannerTxt}>{banner}</Text></View>
      )}

      {uploading && (
        <View style={styles.activeCard}>
          <Text style={styles.cardTitle}>Uploading new model… {uploadPct}%</Text>
          <ProgressBar percent={uploadPct} />
        </View>
      )}

      {activeImports.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>In progress</Text>
          {activeImports.map((imp) => (
            <View key={imp.id} style={styles.activeCard}>
              <View style={styles.rowTop}>
                <Text style={styles.cardTitle} numberOfLines={1}>{imp.originalName}</Text>
                <ImportStatusChip status={imp.status} />
              </View>
              <PipelineStepper row={imp} />
              <ProgressBar percent={imp.progress} />
              <Text style={styles.cardMsg}>
                {imp.progress}%{imp.nodeCount ? ` · ${imp.nodeCount} parts` : ''}
                {typeof imp.ahead === 'number' && imp.ahead > 0 ? ` · ${imp.ahead} ahead in queue` : ''}
              </Text>
            </View>
          ))}
        </>
      )}

      <Text style={styles.sectionTitle}>History</Text>
      {imports.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-offline-outline" size={34} color={Colors.medium} />
          <Text style={styles.muted}>No uploads yet.{canUpload ? ' Tap Upload to add a model.' : ''}</Text>
        </View>
      ) : (
        imports.map((imp) => (
          <ImportHistoryRow key={imp.id} projectId={projectId} imp={imp} onChanged={refresh} />
        ))
      )}
    </ScrollView>
  );
}

/** One history row — tap to reveal the event timeline + conversion snapshot; retry if failed. */
function ImportHistoryRow({ projectId, imp, onChanged }: { projectId: string; imp: MImport; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<MImportDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryErr, setRetryErr] = useState<string | null>(null);
  const canImport = can('projects.import');

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      setLoadingDetail(true);
      try {
        setDetail(await projectsService.getImportDetail(projectId, imp.id));
      } catch {
        /* leave detail null — show the basics we already have */
      } finally {
        setLoadingDetail(false);
      }
    }
  };

  const retry = async () => {
    setRetrying(true);
    setRetryErr(null);
    try {
      await projectsService.retryImport(projectId, imp.id);
      setDetail(null);
    } catch (e: any) {
      setRetryErr(e?.message || 'Retry failed — try again.');
    } finally {
      setRetrying(false);
      onChanged(); // re-read server state whether or not the retry took
    }
  };

  return (
    <View style={styles.histCard}>
      <TouchableOpacity style={styles.histHead} onPress={toggle} activeOpacity={0.7}>
        <View style={styles.histMain}>
          <Text style={styles.histName} numberOfLines={1}>{imp.originalName}</Text>
          <Text style={styles.histMeta} numberOfLines={1}>
            {imp.nodeCount ? `${imp.nodeCount} parts · ` : ''}
            {imp.modelId ? '3D ready · ' : ''}
            {imp.createdByName ? `${imp.createdByName} · ` : ''}
            {fmtRelTime(imp.createdAt)}
          </Text>
        </View>
        <ImportStatusChip status={imp.status} />
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.medium} style={{ marginLeft: 6 }} />
      </TouchableOpacity>

      {imp.status === 'failed' && !!imp.error && (
        <Text style={styles.errTxt} numberOfLines={open ? undefined : 2}>{imp.error}</Text>
      )}

      {open && (
        <View style={styles.detail}>
          {loadingDetail ? (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: 10 }} />
          ) : (
            <>
              {detail?.conversion && (
                <View style={styles.convBox}>
                  <Text style={styles.convTitle}>3D conversion</Text>
                  <Text style={styles.convMeta}>
                    {detail.conversion.status} · {detail.conversion.progress}%
                    {detail.conversion.trianglesAfter ? ` · ${detail.conversion.trianglesAfter.toLocaleString()} tris` : ''}
                    {detail.conversion.outputSize ? ` · ${fmtBytes(detail.conversion.outputSize)}` : ''}
                    {detail.conversion.durationMs ? ` · ${fmtDuration(detail.conversion.durationMs)}` : ''}
                  </Text>
                </View>
              )}

              {(detail?.events?.length ?? 0) > 0 && (
                <View style={styles.timeline}>
                  {detail!.events.map((ev) => (
                    <View key={ev.id} style={styles.tlRow}>
                      <View style={styles.tlDot} />
                      <View style={styles.tlBody}>
                        <Text style={styles.tlMsg}>{ev.message || ev.stage}</Text>
                        <Text style={styles.tlTime}>{ev.progress}% · {fmtRelTime(ev.createdAt)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.detailMetaRow}>
                {!!imp.format && <Text style={styles.detailMeta}>{imp.format.toUpperCase()}</Text>}
                {imp.size != null && <Text style={styles.detailMeta}>{fmtBytes(imp.size)}</Text>}
                {imp.durationMs != null && <Text style={styles.detailMeta}>took {fmtDuration(imp.durationMs)}</Text>}
              </View>

              {imp.status === 'failed' && canImport && (
                <>
                  {!!retryErr && <Text style={styles.errTxt}>{retryErr}</Text>}
                  <TouchableOpacity style={[styles.retryBtn, retrying && styles.disabled]} onPress={retry} disabled={retrying}>
                    {retrying ? <ActivityIndicator color={Colors.white} /> : (
                      <>
                        <Ionicons name="refresh" size={16} color={Colors.white} />
                        <Text style={styles.retryTxt}>Retry import</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: Colors.background },
  headBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headBtnTxt: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 10, marginBottom: 8 },
  banner: { backgroundColor: '#fdecea', borderRadius: 8, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#f5c6cb' },
  bannerTxt: { color: Colors.danger, fontSize: 13 },
  activeCard: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 14, marginBottom: 10, gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text },
  cardMsg: { fontSize: 12, color: Colors.textSecondary },
  empty: { padding: 28, alignItems: 'center', gap: 8 },
  muted: { color: Colors.textSecondary, textAlign: 'center' },
  histCard: { backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 8 },
  histHead: { flexDirection: 'row', alignItems: 'center' },
  histMain: { flex: 1, marginRight: 8 },
  histName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  histMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  errTxt: { color: Colors.danger, fontSize: 12, marginTop: 8 },
  detail: { marginTop: 10, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10, gap: 10 },
  convBox: { backgroundColor: Colors.background, borderRadius: 8, padding: 10 },
  convTitle: { fontSize: 12, fontWeight: '700', color: Colors.text },
  convMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 3 },
  timeline: { gap: 8 },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tlDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 4 },
  tlBody: { flex: 1 },
  tlMsg: { fontSize: 13, color: Colors.text },
  tlTime: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  detailMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  detailMeta: { fontSize: 11, color: Colors.textSecondary },
  retryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 8, paddingVertical: 10, marginTop: 2 },
  retryTxt: { color: Colors.white, fontWeight: '700', fontSize: 14 },
  disabled: { opacity: 0.5 },
});
