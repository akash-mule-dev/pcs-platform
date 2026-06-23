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
  /** The fabrication operation the NCR was raised at (process stage + WO-stage instance). */
  stageId: string | null;
  workOrderStageId: string | null;
  data: Record<string, any> | null;
  status: QualityReportStatus;
  filledBy: string | null;
  submittedAt: string | null;
  /** NCR close: an 'ncr' report is OPEN (blocks gates) while this is null. */
  resolvedAt: string | null;
  resolvedBy: string | null;
  // NCR lifecycle (ncr reports): open → under_review → dispositioned → closed (+ cancelled)
  ncrStatus: string | null;
  disposition: string | null;
  dispositionNotes: string | null;
  dispositionBy: string | null;
  dispositionAt: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  concessionBy: string | null;
  concessionReason: string | null;
  sourceQualityDataId: string | null;
  createdAt: string;
  updatedAt: string;
  // Enriched context
  orderNumber: string | null;
  customerName: string | null;
  projectName: string | null;
  itemMark: string | null;
  filledByName: string | null;
  dispositionByName: string | null;
  resolvedByName: string | null;
}

export interface NcrEvent {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  disposition: string | null;
  note: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
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

  /** Start a BLANK report from a template against a work order (optionally at a stage). */
  create(body: { templateId: string; productionOrderId: string; assemblyNodeId?: string; stageId?: string; workOrderStageId?: string }): Observable<QualityReport> {
    return this.http.post<QualityReport>(this.base, body);
  }

  /** Save filled values; pass status 'submitted' to submit. */
  update(id: string, body: { data?: Record<string, any>; status?: QualityReportStatus }): Observable<QualityReport> {
    return this.http.patch<QualityReport>(`${this.base}/${id}`, body);
  }

  remove(id: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${this.base}/${id}`);
  }

  /** Record the Material-Review disposition (rework/repair/use-as-is/scrap/return). */
  disposition(id: string, body: { disposition: string; dispositionNotes?: string; rootCause?: string; correctiveAction?: string; concessionReason?: string }): Observable<QualityReport> {
    return this.http.post<QualityReport>(`${this.base}/${id}/disposition`, body);
  }

  /** Move an open NCR into "under review". */
  startReview(id: string, note?: string): Observable<QualityReport> {
    return this.http.post<QualityReport>(`${this.base}/${id}/start-review`, { note });
  }

  /** Close an NCR — lifts its shipping + quality-stage gates (needs a disposition first). */
  resolve(id: string): Observable<QualityReport> {
    return this.http.post<QualityReport>(`${this.base}/${id}/resolve`, {});
  }

  /** Reopen a closed NCR report (re-blocks its gates). */
  reopen(id: string): Observable<QualityReport> {
    return this.http.post<QualityReport>(`${this.base}/${id}/reopen`, {});
  }

  /** Cancel an NCR raised in error (lifts gates; recorded as voided). */
  cancel(id: string, note?: string): Observable<QualityReport> {
    return this.http.post<QualityReport>(`${this.base}/${id}/cancel`, { note });
  }

  /** Add a comment to an NCR's activity log. */
  comment(id: string, note: string): Observable<{ ok: true }> {
    return this.http.post<{ ok: true }>(`${this.base}/${id}/comment`, { note });
  }

  /** The NCR activity timeline. */
  events(id: string): Observable<NcrEvent[]> {
    return this.http.get<NcrEvent[]>(`${this.base}/${id}/events`);
  }

  /** The shareable fill URL (used by web nav and by mobile with ?token=). */
  fillUrl(id: string): string {
    return `${location.origin}/qr/${id}`;
  }
}
