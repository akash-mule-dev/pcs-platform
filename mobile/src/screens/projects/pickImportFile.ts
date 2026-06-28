import * as DocumentPicker from 'expo-document-picker';
import { ACCEPTED_IMPORT_EXTENSIONS, MUploadFile } from '../../services/projects.service';

export interface PickedImportFile extends MUploadFile {
  size?: number | null;
}

/**
 * Open the device file picker for a CAD/IFC/ZIP source and validate its
 * extension against what the import pipeline accepts. Returns null when the
 * user cancels; throws a friendly error for an unsupported type.
 */
export async function pickImportFile(): Promise<PickedImportFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled) return null;
  const asset = res.assets?.[0];
  if (!asset) return null;

  const ext = (asset.name?.split('.').pop() || '').toLowerCase();
  if (!ACCEPTED_IMPORT_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Unsupported file type${ext ? ` ".${ext}"` : ''}. Accepted: ${ACCEPTED_IMPORT_EXTENSIONS.join(', ')}`,
    );
  }
  return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size };
}
