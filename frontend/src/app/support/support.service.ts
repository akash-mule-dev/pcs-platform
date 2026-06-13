import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';

export interface TicketMessage {
  id: string;
  authorName: string | null;
  authorKind: 'customer' | 'support' | 'system';
  body: string;
  internal: boolean;
  createdAt: string;
}
export interface TicketSummary {
  id: string;
  number: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  raisedByName: string | null;
  assignedToName: string | null;
  assignedToUserId: string | null;
  organizationId: string | null;
  organizationName?: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}
export interface TicketDetail extends TicketSummary {
  description: string;
  raisedByEmail: string | null;
  contextUrl: string | null;
  appVersion: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  messages: TicketMessage[];
}
export interface SupportMeta {
  statuses: { value: string; label: string }[];
  priorities: { value: string; label: string }[];
  categories: { value: string; label: string }[];
}

/** Customer-facing support API (the caller's own organization). */
@Injectable({ providedIn: 'root' })
export class SupportApiService {
  constructor(private api: ApiService) {}

  meta(): Observable<SupportMeta> { return this.api.get('/support/meta'); }
  list(params?: { status?: string; q?: string }): Observable<TicketSummary[]> { return this.api.get('/support/tickets', params); }
  get(id: string): Observable<TicketDetail> { return this.api.get(`/support/tickets/${id}`); }
  create(body: { subject: string; description: string; category?: string; priority?: string; contextUrl?: string; appVersion?: string }): Observable<TicketDetail> {
    return this.api.post('/support/tickets', body);
  }
  reply(id: string, body: string): Observable<TicketDetail> { return this.api.post(`/support/tickets/${id}/messages`, { body }); }
  close(id: string): Observable<TicketDetail> { return this.api.post(`/support/tickets/${id}/close`, {}); }
}
