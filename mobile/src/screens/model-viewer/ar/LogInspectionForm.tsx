// Modal form to log a quality inspection from within the AR session.
// The parent supplies modelId + inspector and posts the result; this component
// only collects fields. Measurement is prefilled from the AR ruler when present,
// so "measure in AR → log" feeds the backend's auto-fail-against-tolerance check.
import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Colors } from '../../../theme/colors';
import { QualityStatus } from './useQualityData';

export interface InspectionFormResult {
  meshName: string;
  status: QualityStatus;
  defectType?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  measurementValue?: number;
  measurementUnit?: string;
  toleranceMin?: number;
  toleranceMax?: number;
  notes?: string;
}

interface Props {
  visible: boolean;
  partNames: string[];
  defaultMeasurement?: number | null;
  submitting?: boolean;
  onSubmit: (result: InspectionFormResult) => void;
  onCancel: () => void;
}

const STATUSES: QualityStatus[] = ['pass', 'fail', 'warning'];
const SEVERITIES: Array<'low' | 'medium' | 'high' | 'critical'> = ['low', 'medium', 'high', 'critical'];

const STATUS_COLOR: Record<QualityStatus, string> = {
  pass: Colors.success,
  fail: Colors.danger,
  warning: Colors.warning,
};

function toNum(v: string): number | undefined {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function LogInspectionForm({
  visible,
  partNames,
  defaultMeasurement,
  submitting,
  onSubmit,
  onCancel,
}: Props) {
  const [meshName, setMeshName] = useState('');
  const [status, setStatus] = useState<QualityStatus>('pass');
  const [defectType, setDefectType] = useState('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical' | undefined>(undefined);
  const [measurement, setMeasurement] = useState('');
  const [tolMin, setTolMin] = useState('');
  const [tolMax, setTolMax] = useState('');
  const [notes, setNotes] = useState('');

  // Reset + prefill each time the form opens.
  useEffect(() => {
    if (visible) {
      setMeshName(partNames[0] ?? '');
      setStatus('pass');
      setDefectType('');
      setSeverity(undefined);
      setMeasurement(
        defaultMeasurement != null ? String(Math.round(defaultMeasurement * 1000) / 1000) : '',
      );
      setTolMin('');
      setTolMax('');
      setNotes('');
    }
  }, [visible, defaultMeasurement, partNames]);

  const canSubmit = meshName.trim().length > 0 && !submitting;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      meshName: meshName.trim(),
      status,
      defectType: defectType.trim() || undefined,
      severity,
      measurementValue: toNum(measurement),
      measurementUnit: measurement ? 'm' : undefined,
      toleranceMin: toNum(tolMin),
      toleranceMax: toNum(tolMax),
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Log Inspection</Text>
            <TouchableOpacity onPress={onCancel}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Region / mesh</Text>
            <TextInput
              style={styles.input}
              value={meshName}
              onChangeText={setMeshName}
              placeholder="e.g. beam_01"
              placeholderTextColor={Colors.medium}
            />
            {partNames.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {partNames.slice(0, 30).map((name) => (
                  <TouchableOpacity
                    key={name}
                    style={[styles.chip, meshName === name && styles.chipActive]}
                    onPress={() => setMeshName(name)}
                  >
                    <Text style={[styles.chipText, meshName === name && styles.chipTextActive]} numberOfLines={1}>
                      {name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <Text style={styles.label}>Status</Text>
            <View style={styles.row}>
              {STATUSES.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.statusBtn,
                    status === s && { backgroundColor: STATUS_COLOR[s], borderColor: STATUS_COLOR[s] },
                  ]}
                  onPress={() => setStatus(s)}
                >
                  <Text style={[styles.statusBtnText, status === s && styles.statusBtnTextActive]}>
                    {s.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Defect type (optional)</Text>
            <TextInput
              style={styles.input}
              value={defectType}
              onChangeText={setDefectType}
              placeholder="e.g. weld porosity"
              placeholderTextColor={Colors.medium}
            />

            <Text style={styles.label}>Severity (optional)</Text>
            <View style={styles.row}>
              {SEVERITIES.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, severity === s && styles.chipActive]}
                  onPress={() => setSeverity(severity === s ? undefined : s)}
                >
                  <Text style={[styles.chipText, severity === s && styles.chipTextActive]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Measurement (m){defaultMeasurement != null ? ' · from AR ruler' : ''}</Text>
            <TextInput
              style={styles.input}
              value={measurement}
              onChangeText={setMeasurement}
              keyboardType="numeric"
              placeholder="0.000"
              placeholderTextColor={Colors.medium}
            />
            <View style={styles.row}>
              <View style={styles.half}>
                <Text style={styles.label}>Tol. min</Text>
                <TextInput
                  style={styles.input}
                  value={tolMin}
                  onChangeText={setTolMin}
                  keyboardType="numeric"
                  placeholder="min"
                  placeholderTextColor={Colors.medium}
                />
              </View>
              <View style={styles.half}>
                <Text style={styles.label}>Tol. max</Text>
                <TextInput
                  style={styles.input}
                  value={tolMax}
                  onChangeText={setTolMax}
                  keyboardType="numeric"
                  placeholder="max"
                  placeholderTextColor={Colors.medium}
                />
              </View>
            </View>

            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.notes]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Observations…"
              placeholderTextColor={Colors.medium}
              multiline
            />

            <TouchableOpacity
              style={[styles.submit, !canSubmit && styles.submitDisabled]}
              onPress={submit}
              disabled={!canSubmit}
            >
              <Text style={styles.submitText}>{submitting ? 'Saving…' : 'Save inspection'}</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>
              If a measurement falls outside the tolerance, the backend marks it failed automatically.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '85%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  close: { fontSize: 20, color: Colors.textSecondary, paddingHorizontal: 8 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: Colors.light,
  },
  notes: { height: 70, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  half: { flex: 1 },
  chipRow: { marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: Colors.light,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.text, maxWidth: 140 },
  chipTextActive: { color: Colors.white },
  statusBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.light,
  },
  statusBtnText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  statusBtnTextActive: { color: Colors.white },
  submit: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 11, color: Colors.medium, textAlign: 'center', marginTop: 10, marginBottom: 8 },
});
