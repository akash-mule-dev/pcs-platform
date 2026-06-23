import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { modelCache } from '../../services/modelCache';
import { dataCache } from '../../services/dataCache';

function fmtBytes(b: number): string {
  if (!b) return '0 MB';
  const mb = b / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

/**
 * Offline 3D model cache controls. Project GLBs are cached on device (persists
 * across logout) so the viewers load instantly and work offline. The user can
 * re-cache (pull any new/missing models) or clear the cache to reclaim space.
 */
export function StorageSettingsScreen() {
  const [stats, setStats] = useState<{ count: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState<null | 'clear' | 'cache'>(null);
  const [cachedNow, setCachedNow] = useState(0);

  const refresh = useCallback(async () => {
    try { setStats(await modelCache.stats()); } catch { setStats({ count: 0, bytes: 0 }); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onClear = () => {
    Alert.alert(
      'Clear offline cache',
      `Remove all ${stats?.count ?? 0} cached model${(stats?.count ?? 0) === 1 ? '' : 's'} (${fmtBytes(stats?.bytes ?? 0)}) and saved project data? They’ll re-download / re-fetch the next time you open them.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setBusy('clear');
            await Promise.all([modelCache.clear(), dataCache.clear()]);
            await refresh();
            setBusy(null);
          },
        },
      ],
    );
  };

  const onRecache = async () => {
    setBusy('cache');
    setCachedNow(0);
    try {
      const res = await modelCache.recacheNow((_, ok) => { if (ok) setCachedNow((n) => n + 1); });
      await refresh();
      Alert.alert('Models cached', `Cached ${res.ok} model${res.ok === 1 ? '' : 's'}${res.failed ? `, ${res.failed} failed` : ''}.`);
    } catch {
      Alert.alert('Could not cache', 'Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.headRow}>
          <View style={styles.iconWrap}><Ionicons name="cube" size={22} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Offline 3D models</Text>
            <Text style={styles.subtitle}>Project models and assembly data are saved on this device (kept across sign-outs) so the 3D & AR viewers open instantly and work offline.</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{stats ? stats.count : '—'}</Text>
            <Text style={styles.statLbl}>models</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>{stats ? fmtBytes(stats.bytes) : '—'}</Text>
            <Text style={styles.statLbl}>on device</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity style={[styles.action, busy !== null && styles.disabled]} disabled={busy !== null} onPress={onRecache}>
        {busy === 'cache' ? (
          <><ActivityIndicator color={Colors.primary} /><Text style={styles.actionTxt}>Caching… {cachedNow}</Text></>
        ) : (
          <><Ionicons name="cloud-download-outline" size={20} color={Colors.primary} /><Text style={styles.actionTxt}>Cache project models now</Text></>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={[styles.action, styles.danger, busy !== null && styles.disabled]} disabled={busy !== null} onPress={onClear}>
        {busy === 'clear' ? (
          <ActivityIndicator color={Colors.danger} />
        ) : (
          <><Ionicons name="trash-outline" size={20} color={Colors.danger} /><Text style={[styles.actionTxt, styles.dangerTxt]}>Clear cache</Text></>
        )}
      </TouchableOpacity>

      <Text style={styles.note}>
        Models are cached automatically when you sign in and the first time you open one. Clearing the cache only removes downloaded files — nothing on the server changes.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  card: { backgroundColor: Colors.white, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: Colors.border },
  headRow: { flexDirection: 'row', gap: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#e8f0fe', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 3, lineHeight: 18 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: Colors.border },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 20, fontWeight: '800', color: Colors.text },
  statLbl: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.border },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.white, borderRadius: 12, paddingVertical: 14, marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  actionTxt: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  danger: { borderColor: '#f3c6c6' },
  dangerTxt: { color: Colors.danger },
  disabled: { opacity: 0.5 },
  note: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18, marginTop: 6, paddingHorizontal: 4 },
});
