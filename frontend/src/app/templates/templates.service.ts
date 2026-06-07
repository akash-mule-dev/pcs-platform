import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';

/** API layer for configurable form/report templates (Phase 0c). */
@Injectable({ providedIn: 'root' })
export class TemplatesApiService {
  constructor(private api: ApiService) {}
  list(type?: string): Observable<any> { return this.api.get('/templates', type ? { type } : undefined); }
  create(body: any): Observable<any> { return this.api.post('/templates', body); }
  update(id: string, body: any): Observable<any> { return this.api.patch(`/templates/${id}`, body); }
  remove(id: string): Observable<any> { return this.api.delete(`/templates/${id}`); }
}
