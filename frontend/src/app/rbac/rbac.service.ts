import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';

/** API layer for per-tenant RBAC overrides (Phase 0b). */
@Injectable({ providedIn: 'root' })
export class RbacApiService {
  constructor(private api: ApiService) {}
  list(): Observable<any> { return this.api.get('/rbac/permissions'); }
  upsert(body: any): Observable<any> { return this.api.post('/rbac/permissions', body); }
  remove(id: string): Observable<any> { return this.api.delete(`/rbac/permissions/${id}`); }
  resolve(role: string): Observable<any> { return this.api.get('/rbac/resolve', { role }); }
}
