import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';
import { PagedTickets, SupportAgent, SupportMeta, TicketDetail } from './support.service';

/** Platform-facing support desk API (cross-tenant). */
@Injectable({ providedIn: 'root' })
export class SupportDeskApiService {
  constructor(private api: ApiService) {}

  meta(): Observable<SupportMeta> { return this.api.get('/support-desk/meta'); }
  stats(): Observable<Record<string, number>> { return this.api.get('/support-desk/stats'); }
  agents(): Observable<SupportAgent[]> { return this.api.getList('/support-desk/agents'); }
  list(params?: { status?: string; priority?: string; organizationId?: string; assignedToUserId?: string; q?: string; limit?: number; offset?: number }): Observable<PagedTickets> {
    return this.api.get('/support-desk/tickets', params);
  }
  get(id: string): Observable<TicketDetail> { return this.api.get(`/support-desk/tickets/${id}`); }
  reply(id: string, body: string, internal: boolean): Observable<TicketDetail> {
    return this.api.post(`/support-desk/tickets/${id}/messages`, { body, internal });
  }
  replyWithAttachment(id: string, file: File, body: string, internal: boolean): Observable<TicketDetail> {
    const form = new FormData();
    form.append('file', file);
    if (body) form.append('body', body);
    form.append('internal', String(internal));
    return this.api.postForm(`/support-desk/tickets/${id}/attachments`, form);
  }
  update(id: string, body: { status?: string; priority?: string; assignedToUserId?: string | null; expectedVersion?: number }): Observable<TicketDetail> {
    return this.api.patch(`/support-desk/tickets/${id}`, body);
  }
  attachment(ticketId: string, messageId: string, index: number): Observable<Blob> {
    return this.api.getBlob(`/support-desk/tickets/${ticketId}/messages/${messageId}/attachments/${index}`);
  }
}
