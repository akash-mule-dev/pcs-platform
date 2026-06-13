import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';

export interface LibraryStage {
  id: string;
  name: string;
  sequence: number;
  targetTimeSeconds: number;
  requiresInspection: boolean;
}
export interface LibraryProcess {
  id: string;
  name: string;
  version: number;
  stages: LibraryStage[];
}
export interface LibraryTemplate {
  id: string;
  name: string;
  type: string;
  version: number;
}
export interface LibrarySummary {
  organization: { id: string; name: string; slug: string };
  processes: number;
  templates: number;
}
export interface PublishResult {
  organizationId: string;
  created: boolean;
  id: string;
}

/** Platform-only API for the shared library of default processes & templates. */
@Injectable({ providedIn: 'root' })
export class LibraryApiService {
  constructor(private api: ApiService) {}

  summary(): Observable<LibrarySummary> { return this.api.get('/library/summary'); }
  processes(): Observable<LibraryProcess[]> { return this.api.get('/library/processes'); }
  templates(): Observable<LibraryTemplate[]> { return this.api.get('/library/templates'); }

  publishProcess(id: string, body: { organizationId?: string; allTenants?: boolean }): Observable<any> {
    return this.api.post(`/library/processes/${id}/publish`, body);
  }
  publishTemplate(id: string, body: { organizationId?: string; allTenants?: boolean }): Observable<any> {
    return this.api.post(`/library/templates/${id}/publish`, body);
  }
}
