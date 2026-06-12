// AR QA capture — reads/writes inspection records against the existing backend
// quality-data API (no backend changes needed):
//   GET  /quality-data/by-model/:modelId
//   POST /quality-data                       (auto-fails if measurement is out of tolerance)
//   PATCH /quality-data/:id/signoff
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../../services/api.service';
import { QualityEntry } from '../../../types';
import { offlineService } from '../../../services/offline.service';
import {
  createQuality,
  createNcr,
  uploadEvidence as apiUploadEvidence,
  CreateNcrInput,
  CreatedNcr,
} from './qaApi';
import { qaOfflineQueue } from './qaOfflineQueue';

export type QualityStatus = 'pass' | 'fail' | 'warning';

// The backend entity carries sign-off fields the shared QualityEntry type omits.
export interface ARQualityEntry extends QualityEntry {
  regionLabel?: string | null;
  signoffStatus?: 'pending' | 'approved' | 'rejected';
  signoffBy?: string | null;
}

export interface CreateQualityInput {
  modelId: string;
  meshName: string;
  regionLabel?: string;
  status: QualityStatus;
  inspector?: string;
  notes?: string;
  defectType?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  measurementValue?: number;
  measurementUnit?: string;
  toleranceMin?: number;
  toleranceMax?: number;
}

export interface QualitySummary {
  total: number;
  pass: number;
  fail: number;
  warning: number;
}

export function summarize(entries: ARQualityEntry[]): QualitySummary {
  return {
    total: entries.length,
    pass: entries.filter((e) => e.status === 'pass').length,
    fail: entries.filter((e) => e.status === 'fail').length,
    warning: entries.filter((e) => e.status === 'warning').length,
  };
}

/** Build an optimistic local entry shown immediately while a create is queued offline. */
function optimisticEntry(input: CreateQualityInput): ARQualityEntry {
  return {
    id: `pending-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    modelId: input.modelId,
    meshName: input.meshName,
    status: input.status,
    inspectorId: '',
    defectType: input.defectType ?? null,
    severity: input.severity ?? null,
    measurement: input.measurementValue ?? null,
    toleranceMin: input.toleranceMin ?? null,
    toleranceMax: input.toleranceMax ?? null,
    notes: input.notes ?? null,
    createdAt: new Date().toISOString(),
    regionLabel: input.regionLabel ?? null,
    signoffStatus: 'pending',
  };
}

export function useQualityData(modelId: string | null) {
  const [entries, setEntries] = useState<ARQualityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const prevPendingRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!modelId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ARQualityEntry[]>(`/quality-data/by-model/${modelId}`);
      setEntries(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load quality data');
    } finally {
      setLoading(false);
    }
  }, [modelId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Track the offline queue; when it drains (count drops) the queued entries
  // have synced, so pull the authoritative list from the server.
  useEffect(() => {
    const unsub = qaOfflineQueue.subscribe((count) => {
      if (count < prevPendingRef.current) void refresh();
      prevPendingRef.current = count;
      setPendingCount(count);
    });
    // In case connectivity was restored while this model wasn't open.
    void qaOfflineQueue.flush();
    return unsub;
  }, [refresh]);

  const create = useCallback(
    async (input: CreateQualityInput, evidenceUri?: string): Promise<ARQualityEntry> => {
      if (!offlineService.isOnline) {
        await qaOfflineQueue.enqueue(input, evidenceUri);
        const optimistic = optimisticEntry(input);
        setEntries((prev) => [optimistic, ...prev]);
        return optimistic;
      }
      const created = await createQuality(input);
      if (evidenceUri) {
        // Entry is saved even if the image upload fails — it can be re-attached.
        try { await apiUploadEvidence(created.id, evidenceUri); } catch { /* retryable */ }
      }
      await refresh();
      return created;
    },
    [refresh],
  );

  const uploadEvidence = useCallback(
    async (entryId: string, fileUri: string): Promise<ARQualityEntry> => {
      const updated = await apiUploadEvidence(entryId, fileUri);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const raiseNcr = useCallback(
    async (input: CreateNcrInput): Promise<CreatedNcr> => createNcr(input),
    [],
  );

  const signoff = useCallback(
    // signoffBy is accepted for call-site compatibility but ignored — the
    // backend stamps the decider's identity from the JWT (not spoofable).
    async (id: string, status: 'approved' | 'rejected', _signoffBy?: string, notes?: string) => {
      await api.patch(`/quality-data/${id}/signoff`, { status, notes });
      await refresh();
    },
    [refresh],
  );

  return {
    entries,
    loading,
    error,
    pendingCount,
    refresh,
    create,
    uploadEvidence,
    raiseNcr,
    signoff,
  };
}
