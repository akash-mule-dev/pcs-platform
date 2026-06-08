import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { StatusBadge } from '../../components/StatusBadge';
import { ncrService, Ncr } from '../../services/factory.service';
import { MoreStackParamList } from '../../navigation/types';

export function NcrDetailScreen() {
  const route = useRoute<RouteProp<MoreStackParamList, 'NcrDetail'>>();
  const { id } = route.params;
  const [ncr, setNcr] = useState<Ncr | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    ncrService.getOne(id)
      .then((n) => { if (active) { setNcr(n); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  if (loading) return <View style={styles.center}><Text style={styles.muted}>Loading…</Text></View>;
  if (!ncr) return <View style={styles.center}><Text style={styles.muted}>NCR not found.</Text></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.number}>{ncr.number}</Text>
        <StatusBadge status={ncr.status} />
      </View>
      <Text style={styles.title}>{ncr.title}</Text>

      {!!ncr.severity && (
        <View style={styles.row}><Text style={styles.k}>Severity</Text><StatusBadge status={ncr.severity} small /></View>
      )}
      {!!ncr.disposition && (
        <View style={styles.row}><Text style={styles.k}>Disposition</Text><Text style={styles.v}>{ncr.disposition}</Text></View>
      )}
      {!!ncr.description && (
        <>
          <Text style={styles.sectionLabel}>Details</Text>
          <Text style={styles.body}>{ncr.description}</Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  muted: { color: Colors.textSecondary, fontSize: 14 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  number: { fontSize: 18, fontWeight: '700', color: Colors.text },
  title: { fontSize: 16, color: Colors.text, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  k: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  v: { fontSize: 14, color: Colors.text, textTransform: 'capitalize' },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginTop: 16 },
  body: { fontSize: 14, color: Colors.text, marginTop: 6, lineHeight: 20 },
});
