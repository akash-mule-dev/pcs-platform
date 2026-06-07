import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';

/** API layer for NCR / CAPA / form templates (Phase 1 + 0c). */
@Injectable({ providedIn: 'root' })
export class NcrApiService {
  constructor(private api: ApiService) {}

  listNcr(status?: string): Observable<any> { return this.api.get('/ncr', status ? { status } : undefined); }
  getNcr(id: string): Observable<any> { return this.api.get(`/ncr/${id}`); }
  createNcr(body: any): Observable<any> { return this.api.post('/ncr', body); }
  updateNcr(id: string, body: any): Observable<any> { return this.api.patch(`/ncr/${id}`, body); }

  listCapa(ncrId?: string): Observable<any> { return this.api.get('/capa', ncrId ? { ncrId } : undefined); }
  createCapa(body: any): Observable<any> { return this.api.post('/capa', body); }
  updateCapa(id: string, body: any): Observable<any> { return this.api.patch(`/capa/${id}`, body); }

  listTemplates(type = 'ncr'): Observable<any> { return this.api.get('/templates', { type }); }
}
