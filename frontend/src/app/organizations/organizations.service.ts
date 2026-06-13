import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';

/** API layer for platform-level organization (tenant) management. */
@Injectable({ providedIn: 'root' })
export class OrganizationsApiService {
  constructor(private api: ApiService) {}
  list(): Observable<any> { return this.api.get('/organizations'); }
  create(body: any): Observable<any> { return this.api.post('/organizations', body); }
  update(id: string, body: any): Observable<any> { return this.api.patch(`/organizations/${id}`, body); }
  impersonate(id: string): Observable<any> { return this.api.post(`/organizations/${id}/impersonate`, {}); }
}
