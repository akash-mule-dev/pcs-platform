import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';
import { SupportMeta, TicketDetail, TicketSummary } from './support.service';

/** Platform-facing support desk API (cross-tenant). */
@Injectable({ providedIn: 'root' })
export class SupportDeskApiService {
  constructor(private api: ApiService) {}

  meta(): Observable<SupportMeta> { return this.api.get('/support-desk/meta'); }
  stats(): Observable<Record<string, number>> { return this.api.get('/support-desk/stats'); }
  list(params?: { status?: string; priority?: string; organizationId?: string; assignedToUserId?: string; q?: string }): Observable<TicketSummary[]> {
    return this.api.get('/support-desk/tickets', params);
  }
  get(id: string): Observable<TicketDetail> { return this.api.get(`/support-desk/tickets/${id}`); }
  reply(id: string, body: string, internal: boolean): Observable<TicketDetail> {
    return this.api.post(`/support-desk/tickets/${id}/messages`, { body, internal });
  }
  update(id: string, body: { status?: string; priority?: string; assignedToUserId?: string | null }): Observable<TicketDetail> {
    return this.api.patch(`/support-desk/tickets/${id}`, body);
  }
}
