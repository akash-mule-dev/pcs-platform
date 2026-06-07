// AR QA capture — reads/writes inspection records against the existing backend
// quality-data API (no backend changes needed):
//   GET  /quality-data/by-model/:modelId
//   POST /quality-data                       (auto-fails if measurement is out of tolerance)
//   PATCH /quality-data/:id/signoff
import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../services/api.service';
import { QualityEntry } from '../../../types';

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

export function useQualityData(modelId: string | null) {
  const [entries, setEntries] = useState<ARQualityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const create = useCallback(
    async (input: CreateQualityInput) => {
      const created = await api.post<ARQualityEntry>('/quality-data', input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const signoff = useCallback(
    async (id: string, status: 'approved' | 'rejected', signoffBy: string, notes?: string) => {
      await api.patch(`/quality-data/${id}/signoff`, { status, signoffBy, notes });
      await refresh();
    },
    [refresh],
  );

  return { entries, loading, error, refresh, create, signoff };
}
