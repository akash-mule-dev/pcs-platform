import React, { useEffect, useLayoutEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { authService } from '../../services/auth.service';
import { environment } from '../../config/environment';

type Rt = RouteProp<ProjectsStackParamList, 'QcReport'>;
type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'QcReport'>;

/**
 * In-app QC report screen. Renders the web /qr/:id fill page (Form.io report,
 * autosave, validation, and — for NCR-type reports — the Resolve/Reopen control)
 * inside a WebView so inspectors never leave the app for the device browser. The
 * page reads `?token=<jwt>` into
 * localStorage for the API interceptor, so DOM storage must stay enabled.
 */
export function QcReportScreen() {
  const route = useRoute<Rt>();
  const navigation = useNavigation<Nav>();
  const { reportId, title } = route.params;
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => { navigation.setOptions({ title: title || 'QC Report' }); }, [navigation, title]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = (await authService.getToken()) ?? '';
        if (alive) setUri(`${environment.webUrl}/qr/${reportId}?token=${encodeURIComponent(token)}`);
      } catch {
        if (alive) setError('Could not open the report.');
      }
    })();
    return () => { alive = false; };
  }, [reportId]);

  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={34} color={Colors.medium} />
        <Text style={styles.err}>{error}</Text>
        {/* Clearing the error remounts the WebView, which reloads the URL. */}
        <TouchableOpacity style={styles.retry} onPress={() => { setError(null); setLoading(true); }}>
          <Text style={styles.retryTxt}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!uri) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setError('Could not load the report (check your connection).'); }}
        onHttpError={(e) => { if ((e.nativeEvent.statusCode ?? 0) >= 500) { setLoading(false); setError('The report server returned an error.'); } }}
        style={styles.web}
      />
      {loading && (
        <View style={styles.overlay}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.loadTxt}>Loading report…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  web: { flex: 1, backgroundColor: '#f1f5f9' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  err: { color: Colors.textSecondary, textAlign: 'center', fontSize: 14 },
  retry: { marginTop: 6, backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10 },
  retryTxt: { color: Colors.white, fontWeight: '700' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(241,245,249,0.85)', gap: 8 },
  loadTxt: { color: Colors.textSecondary, fontSize: 13 },
});
