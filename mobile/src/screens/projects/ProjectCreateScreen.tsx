import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { ProjectsStackParamList } from '../../navigation/types';
import { projectsService } from '../../services/projects.service';
import { can } from '../../config/permissions';
import { pickImportFile, PickedImportFile } from './pickImportFile';
import { ProgressBar } from './ImportPipelineView';
import { fmtBytes } from './monitor-format';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectCreate'>;

type Phase = 'idle' | 'creating' | 'uploading';

/**
 * Create a project (the design container) and, optionally, upload its first
 * CAD/IFC/ZIP model in one pass — the mobile counterpart of the web wizard.
 * On success it lands on the live import monitor (when a file was uploaded) or
 * the project's work orders (when skipped).
 */
export function ProjectCreateScreen() {
  const navigation = useNavigation<Nav>();
  const allowed = can('projects.create');

  const [name, setName] = useState('');
  const [projectNumber, setProjectNumber] = useState('');
  const [clientName, setClientName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<PickedImportFile | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== 'idle';
  const canUpload = can('projects.import');

  const choose = async () => {
    setError(null);
    try {
      const picked = await pickImportFile();
      if (picked) setFile(picked);
    } catch (e: any) {
      setError(e?.message || 'Could not read that file.');
    }
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Project name is required.'); return; }
    setError(null);
    setPhase('creating');
    try {
      const project = await projectsService.create({
        name: trimmed,
        projectNumber: projectNumber.trim() || undefined,
        clientName: clientName.trim() || undefined,
        description: description.trim() || undefined,
      });
      // Refresh the cached portfolio so the new project shows when we return to the list.
      projectsService.list(true).catch(() => {});

      if (file && canUpload) {
        setPhase('uploading');
        setUploadPct(0);
        try {
          await projectsService.importIfc(project.id, file, setUploadPct);
        } catch (e: any) {
          // The project exists; only the upload failed. Send them to the monitor
          // (where they can re-upload) carrying the reason so it's shown there
          // (a setError here would be lost — replace() unmounts this screen).
          navigation.replace('ProjectMonitoring', {
            projectId: project.id,
            name: project.name,
            notice: `Project created, but the model upload failed: ${e?.message || 'unknown error'}. Tap Upload to try again.`,
          });
          return;
        }
        navigation.replace('ProjectMonitoring', { projectId: project.id, name: project.name });
      } else {
        navigation.replace('ProjectDetail', { projectId: project.id, name: project.name });
      }
    } catch (e: any) {
      setError(e?.message || 'Could not create the project.');
      setPhase('idle');
    }
  };

  if (!allowed) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed-outline" size={36} color={Colors.medium} />
        <Text style={styles.muted}>You don’t have permission to create projects.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>Project details</Text>

        <Text style={styles.lbl}>Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Warehouse B – Structural Steel"
          placeholderTextColor={Colors.textSecondary}
          value={name}
          onChangeText={setName}
          editable={!busy}
        />

        <Text style={styles.lbl}>Job / order number</Text>
        <TextInput
          style={styles.input}
          placeholder="Optional"
          placeholderTextColor={Colors.textSecondary}
          value={projectNumber}
          onChangeText={setProjectNumber}
          editable={!busy}
        />

        <Text style={styles.lbl}>Client</Text>
        <TextInput
          style={styles.input}
          placeholder="Optional"
          placeholderTextColor={Colors.textSecondary}
          value={clientName}
          onChangeText={setClientName}
          editable={!busy}
        />

        <Text style={styles.lbl}>Description</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="Optional"
          placeholderTextColor={Colors.textSecondary}
          value={description}
          onChangeText={setDescription}
          editable={!busy}
          multiline
          numberOfLines={3}
        />

        {canUpload && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Model file (optional)</Text>
            {!file ? (
              <>
                <TouchableOpacity style={styles.picker} onPress={choose} disabled={busy}>
                  <Ionicons name="cloud-upload-outline" size={22} color={Colors.primary} />
                  <Text style={styles.pickerTxt}>Choose CAD / IFC / ZIP file</Text>
                </TouchableOpacity>
                <Text style={styles.hint}>
                  IFC, ZIP packages, STEP, IGES, GLB, OBJ, STL and more. You can skip this and
                  upload later from the web or the Monitoring tab.
                </Text>
              </>
            ) : (
              <View style={styles.fileRow}>
                <Ionicons name="document-outline" size={20} color={Colors.primary} />
                <View style={styles.fileBody}>
                  <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                  <Text style={styles.fileMeta}>{fmtBytes(file.size)}</Text>
                </View>
                {!busy && (
                  <TouchableOpacity onPress={() => setFile(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={22} color={Colors.medium} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </>
        )}

        {phase === 'uploading' && (
          <View style={styles.uploadBox}>
            <Text style={styles.uploadTxt}>Uploading… {uploadPct}%</Text>
            <ProgressBar percent={uploadPct} />
          </View>
        )}

        {!!error && <Text style={styles.err}>{error}</Text>}

        <TouchableOpacity
          style={[styles.submit, (busy || !name.trim()) && styles.disabled]}
          disabled={busy || !name.trim()}
          onPress={submit}
        >
          {busy ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.submitTxt}>{file ? 'Create & upload' : 'Create project'}</Text>
          )}
        </TouchableOpacity>
        {phase === 'creating' && <Text style={styles.busyHint}>Creating project…</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  list: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10, backgroundColor: Colors.background },
  muted: { color: Colors.textSecondary, textAlign: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  lbl: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: Colors.white, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: Colors.text },
  multiline: { minHeight: 76, textAlignVertical: 'top' },
  picker: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.primary, borderRadius: 10, paddingVertical: 16, paddingHorizontal: 14, backgroundColor: '#eef2ff' },
  pickerTxt: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
  hint: { color: Colors.textSecondary, fontSize: 12, marginTop: 8, lineHeight: 17 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 12 },
  fileBody: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  fileMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  uploadBox: { marginTop: 16, gap: 8 },
  uploadTxt: { fontSize: 13, fontWeight: '600', color: Colors.text },
  err: { color: Colors.danger, marginTop: 14, fontSize: 13, lineHeight: 18 },
  submit: { backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 22 },
  disabled: { opacity: 0.5 },
  submitTxt: { color: Colors.white, fontWeight: '700', fontSize: 16 },
  busyHint: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 8 },
});
