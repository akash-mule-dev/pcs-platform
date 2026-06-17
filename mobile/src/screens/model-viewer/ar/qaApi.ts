// AR QA write API helpers used by the in-AR capture flows:
//   - evidence image upload (multipart — api.service only does JSON)
//   - the raw quality-data create (so the offline queue can replay it)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../../../services/api.service';
import { environment } from '../../../config/environment';
import type { ARQualityEntry, CreateQualityInput } from './useQualityData';

const TOKEN_KEY = 'auth_token';

/** POST a quality-data entry (the backend auto-fails out-of-tolerance measurements). */
export function createQuality(input: CreateQualityInput): Promise<ARQualityEntry> {
  return api.post<ARQualityEntry>('/quality-data', input);
}

/**
 * Upload an evidence image to a quality entry. Uses fetch + FormData directly
 * because api.service only sends JSON. The image is whatever local file:// uri
 * the AR screenshot produced.
 */
export async function uploadEvidence(
  entryId: string,
  fileUri: string,
): Promise<ARQualityEntry> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  const normalized = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;
  const name = normalized.split('/').pop() || `evidence_${entryId}.jpg`;
  const ext = name.split('.').pop()?.toLowerCase();
  const type = ext === 'png' ? 'image/png' : 'image/jpeg';

  const form = new FormData();
  // RN FormData file shape — the cast is required; RN sets the multipart boundary.
  form.append('file', { uri: normalized, name, type } as any);

  const res = await fetch(`${environment.apiUrl}/quality-data/${entryId}/evidence`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message || `Evidence upload failed (HTTP ${res.status})`);
  }
  const body = await res.json();
  return (body && body.data ? body.data : body) as ARQualityEntry;
}
