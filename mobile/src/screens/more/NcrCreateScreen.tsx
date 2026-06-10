import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ncrService } from '../../services/factory.service';
import { projectsService } from '../../services/projects.service';
import { MoreStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<MoreStackParamList, 'NcrCreate'>;
type Rt = RouteProp<MoreStackParamList, 'NcrCreate'>;
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

export function NcrCreateScreen() {
  const navigation = useNavigation<Nav>();
  const params = (useRoute<Rt>().params ?? {}) as NonNullable<Rt['params']>;
  const [title, setTitle] = useState(params.title ?? '');
  const [description, setDescription] = useState(params.description ?? '');
  const [severity, setSeverity] = useState(params.severity ?? 'medium');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // When opened from a fabrication node, raise via the node endpoint so the NCR
  // is linked to that node/project/work order (and any failing inspection).
  const linked = !!(params.projectId && params.nodeId);

  const submit = async () => {
    if (!title.trim()) { setError('A title is required.'); return; }
    setSaving(true);
    setError('');
    try {
      if (linked) {
        await projectsService.raiseNodeNcr(params.projectId!, params.nodeId!, {
          title: title.trim(),
          description: description.trim() || undefined,
          severity,
          qualityDataId: params.qualityDataId,
        });
      } else {
        await ncrService.create({ title: title.trim(), description: description.trim() || undefined, severity });
      }
      navigation.goBack();
    } catch (e: any) {
      setError(e?.message || 'Failed to raise NCR.');
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Title *</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Short description of the defect"
        placeholderTextColor={Colors.textSecondary}
      />

      <Text style={styles.label}>Details</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder="What's wrong, where, any measurements…"
        placeholderTextColor={Colors.textSecondary}
        multiline
      />

      <Text style={styles.label}>Severity</Text>
      <View style={styles.sevRow}>
        {SEVERITIES.map((s) => (
          <TouchableOpacity key={s} style={[styles.sevChip, severity === s && styles.sevChipOn]} onPress={() => setSeverity(s)}>
            <Text style={[styles.sevText, severity === s && styles.sevTextOn]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.btn, (saving || !title.trim()) && styles.btnDisabled]}
        disabled={saving || !title.trim()}
        onPress={submit}
      >
        <Text style={styles.btnText}>{saving ? 'Submitting…' : 'Raise NCR'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: Colors.white, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12, fontSize: 15, color: Colors.text },
  multiline: { height: 110, textAlignVertical: 'top' },
  sevRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sevChip: { borderWidth: 1, borderColor: Colors.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: Colors.white },
  sevChipOn: { borderColor: Colors.primary, backgroundColor: '#e8f0fe' },
  sevText: { color: Colors.textSecondary, fontWeight: '600', textTransform: 'capitalize' },
  sevTextOn: { color: Colors.primary },
  error: { color: Colors.danger, marginTop: 14, fontSize: 13 },
  btn: { backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 22 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: Colors.white, fontWeight: '700', fontSize: 16 },
});
