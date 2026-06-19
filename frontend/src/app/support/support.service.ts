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
  attachmentCount?: number;
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
  firstResponseAt?: string | null;
  awaitingFirstResponse?: boolean;
}
export interface PagedTickets { items: TicketSummary[]; total: number; limit: number; offset: number; }
export interface TicketDetail extends TicketSummary {
  description: string;
  raisedByEmail: string | null;
  contextUrl: string | null;
  appVersion: string | null;
  firstResponseAt?: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  version?: number;
  messages: TicketMessage[];
}
export interface SupportAgent { id: string; name: string | null; }
export interface SupportOrg { id: string; name: string; }
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
  create(body: { subject: string; description: string; category?: string; priority?: string; contextUrl?: string; appVersion?: string }, file?: File | null): Observable<TicketDetail> {
    if (!file) return this.api.post('/support/tickets', body);
    const form = new FormData();
    form.append('subject', body.subject);
    form.append('description', body.description);
    if (body.category) form.append('category', body.category);
    if (body.priority) form.append('priority', body.priority);
    if (body.contextUrl) form.append('contextUrl', body.contextUrl);
    if (body.appVersion) form.append('appVersion', body.appVersion);
    form.append('file', file);
    return this.api.postForm('/support/tickets', form);
  }
  reply(id: string, body: string): Observable<TicketDetail> { return this.api.post(`/support/tickets/${id}/messages`, { body }); }
  close(id: string): Observable<TicketDetail> { return this.api.post(`/support/tickets/${id}/close`, {}); }

  replyWithAttachment(id: string, file: File, body?: string): Observable<TicketDetail> {
    const form = new FormData();
    form.append('file', file);
    if (body) form.append('body', body);
    return this.api.postForm(`/support/tickets/${id}/attachments`, form);
  }
  attachment(ticketId: string, messageId: string, index: number): Observable<Blob> {
    return this.api.getBlob(`/support/tickets/${ticketId}/messages/${messageId}/attachments/${index}`);
  }
}
