import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export type QualityReportStatus = 'draft' | 'submitted';

export interface QualityReport {
  id: string;
  number: string;
  templateId: string | null;
  templateName: string;
  /** Snapshot of the template type at creation; 'ncr' reports gate shipping + quality stages. */
  templateType: string | null;
  templateSchema: Record<string, any>;
  productionOrderId: string;
  projectId: string | null;
  assemblyNodeId: string | null;
  data: Record<string, any> | null;
  status: QualityReportStatus;
  filledBy: string | null;
  submittedAt: string | null;
  /** NCR close: an 'ncr' report is OPEN (blocks gates) while this is null. */
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  // Enriched context
  orderNumber: string | null;
  customerName: string | null;
  projectName: string | null;
  itemMark: string | null;
}

export interface ReportTemplate { id: string; name: string; type: string; schema: Record<string, any> | null; version: number; }

/** QC report templates + filled reports (drag-drop Form.io templates → reports against work orders). */
@Injectable({ providedIn: 'root' })
export class QualityReportsService {
  private readonly base = `${environment.apiUrl}/quality-reports`;

  constructor(private http: HttpClient) {}

  /** All form templates (tolerant of array or paged responses). */
  listTemplates(): Observable<ReportTemplate[]> {
    return this.http.get<any>(`${environment.apiUrl}/templates`).pipe(
      map((r) => (Array.isArray(r) ? r : (r?.data ?? r?.items ?? []))),
    );
  }

  list(filter?: { productionOrderId?: string; projectId?: string; status?: string }): Observable<QualityReport[]> {
    const params: Record<string, string> = {};
    if (filter?.productionOrderId) params['productionOrderId'] = filter.productionOrderId;
    if (filter?.projectId) params['projectId'] = filter.projectId;
    if (filter?.status) params['status'] = filter.status;
    return this.http.get<QualityReport[]>(this.base, { params });
  }

  get(id: string): Observable<QualityReport> {
    return this.http.get<QualityReport>(`${this.base}/${id}`);
  }

  /** Start a BLANK report from a template against a work order. */
  create(body: { templateId: string; productionOrderId: string; assemblyNodeId?: string }): Observable<QualityReport> {
    return this.http.post<QualityReport>(this.base, body);
  }

  /** Save filled values; pass status 'submitted' to submit. */
  update(id: string, body: { data?: Record<string, any>; status?: QualityReportStatus }): Observable<QualityReport> {
    return this.http.patch<QualityReport>(`${this.base}/${id}`, body);
  }

  remove(id: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${this.base}/${id}`);
  }

  /** Resolve (close) an NCR report — lifts its shipping + quality-stage gates. */
  resolve(id: string): Observable<QualityReport> {
    return this.http.post<QualityReport>(`${this.base}/${id}/resolve`, {});
  }

  /** Reopen a resolved NCR report (re-blocks its gates). */
  reopen(id: string): Observable<QualityReport> {
    return this.http.post<QualityReport>(`${this.base}/${id}/reopen`, {});
  }

  /** The shareable fill URL (used by web nav and by mobile with ?token=). */
  fillUrl(id: string): string {
    return `${location.origin}/qr/${id}`;
  }
}
