import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';

export interface NcrRow {
  id: string;
  number: string;
  title: string;
  description?: string | null;
  status: string;
  severity: string;
  disposition?: string | null;
  dispositionNote?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  assemblyNodeId?: string | null;
  itemMark?: string | null;
  workOrderId?: string | null;
  assignedTo?: string | null;
  closedAt?: string | null;
  createdAt?: string;
  /** Present on GET /ncr/:id — legal next statuses for guided transitions. */
  allowedTransitions?: string[];
}

export interface NcrEventRow {
  id: string;
  type: 'created' | 'status_change' | 'disposition' | 'assignment' | 'comment';
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  actorName?: string | null;
  createdAt: string;
}

export interface NcrFilters {
  status?: string;
  severity?: string;
  projectId?: string;
  open?: 'true';
  q?: string;
}

/** API layer for NCR / CAPA / form templates. */
@Injectable({ providedIn: 'root' })
export class NcrApiService {
  constructor(private api: ApiService) {}

  listNcr(filters?: NcrFilters): Observable<NcrRow[]> {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(filters ?? {})) if (v) params[k] = v;
    return this.api.get('/ncr', Object.keys(params).length ? params : undefined);
  }
  getNcr(id: string): Observable<NcrRow> { return this.api.get(`/ncr/${id}`); }
  createNcr(body: any): Observable<NcrRow> { return this.api.post('/ncr', body); }
  updateNcr(id: string, body: any): Observable<NcrRow> { return this.api.patch(`/ncr/${id}`, body); }
  listEvents(id: string): Observable<NcrEventRow[]> { return this.api.get(`/ncr/${id}/events`); }
  addComment(id: string, note: string): Observable<NcrEventRow> { return this.api.post(`/ncr/${id}/comments`, { note }); }

  listCapa(ncrId?: string): Observable<any> { return this.api.get('/capa', ncrId ? { ncrId } : undefined); }
  createCapa(body: any): Observable<any> { return this.api.post('/capa', body); }
  updateCapa(id: string, body: any): Observable<any> { return this.api.patch(`/capa/${id}`, body); }

  listTemplates(type = 'ncr'): Observable<any> { return this.api.get('/templates', { type }); }
}
