import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';

export interface QualityDataEntry {
  id: string;
  modelId: string;
  meshName: string;
  regionLabel: string | null;
  status: 'pass' | 'fail' | 'warning';
  inspector: string | null;
  inspectionDate: string | null;
  notes: string | null;
  defectType: string | null;
  severity: string | null;
  measurementValue: number | null;
  measurementUnit: string | null;
  toleranceMin: number | null;
  toleranceMax: number | null;
  createdAt: string;
}

export interface QualitySummary {
  total: number;
  pass: number;
  fail: number;
  warning: number;
}

@Injectable({ providedIn: 'root' })
export class QualityService {
  constructor(private api: ApiService) {}

  getByModel(modelId: string): Observable<QualityDataEntry[]> {
    return this.api.get<QualityDataEntry[]>(`/quality-data/by-model/${modelId}`);
  }

  getSummary(modelId: string): Observable<QualitySummary> {
    return this.api.get<QualitySummary>(`/quality-data/summary/${modelId}`);
  }

  getOne(id: string): Observable<QualityDataEntry> {
    return this.api.get<QualityDataEntry>(`/quality-data/${id}`);
  }

  create(data: Partial<QualityDataEntry>): Observable<QualityDataEntry> {
    return this.api.post<QualityDataEntry>('/quality-data', data);
  }

  bulkCreate(items: Partial<QualityDataEntry>[]): Observable<QualityDataEntry[]> {
    return this.api.post<QualityDataEntry[]>('/quality-data/bulk', { items });
  }

  update(id: string, data: Partial<QualityDataEntry>): Observable<QualityDataEntry> {
    return this.api.patch<QualityDataEntry>(`/quality-data/${id}`, data);
  }

  delete(id: string): Observable<void> {
    return this.api.delete<void>(`/quality-data/${id}`);
  }

  deleteByModel(modelId: string): Observable<void> {
    return this.api.delete<void>(`/quality-data/by-model/${modelId}`);
  }

  // Phase 6: Quality trend tracking
  getTrends(modelId: string): Observable<{ date: string; status: string; count: string }[]> {
    return this.api.get<any[]>(`/quality-data/trends/${modelId}`);
  }

  // Phase 6: Defect pattern analysis
  getDefectPatterns(modelId: string): Observable<{ meshName: string; regionLabel: string; defectType: string; occurrences: string; failRate: string }[]> {
    return this.api.get<any[]>(`/quality-data/defect-patterns/${modelId}`);
  }

  // Phase 6: Sign-off workflow
  getPendingSignoffs(modelId?: string): Observable<QualityDataEntry[]> {
    const params = modelId ? { modelId } : {};
    return this.api.get<QualityDataEntry[]>('/quality-data/pending-signoffs', params);
  }

  signoff(id: string, status: 'approved' | 'rejected', signoffBy: string, notes?: string): Observable<QualityDataEntry> {
    return this.api.patch<QualityDataEntry>(`/quality-data/${id}/signoff`, { status, signoffBy, notes });
  }
}
