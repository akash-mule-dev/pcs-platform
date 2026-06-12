import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type ConversionStatus =
  | 'pending' | 'converting' | 'optimizing' | 'uploading' | 'completed' | 'failed';

export interface ConversionJob {
  id: string;
  status: ConversionStatus;
  progress: number;
  originalName: string;
  sourceFormat: string;
  modelId: string | null;
  outputSize: number | null;
  trianglesBefore: number | null;
  trianglesAfter: number | null;
  error: string | null;
  durationMs?: number | null;
  dimensions?: { x: number; y: number; z: number } | null;
  createdAt: string;
}

/** Payload of the backend `conversion:progress` Socket.IO event. */
export interface ConversionProgress {
  jobId: string;
  status: ConversionStatus | string;
  progress: number;
  originalName?: string;
  sourceFormat?: string;
  modelId?: string | null;
  trianglesBefore?: number | null;
  trianglesAfter?: number | null;
  dimensions?: { x: number; y: number; z: number } | null;
  error?: string | null;
}

export interface ConvertOptions {
  name: string;
  description?: string;
  modelType?: 'assembly' | 'quality';
  optimize?: boolean;
  simplifyRatio?: number;
  draco?: boolean;
  sourceUnit?: string;
  upAxis?: 'Y' | 'Z';
}

export interface SupportedFormat {
  extension: string;
  description: string;
}

export interface SupportedFormats {
  input: SupportedFormat[];
  output: SupportedFormat[];
}

@Injectable({ providedIn: 'root' })
export class ConversionApiService {
  private readonly base = `${environment.apiUrl}/conversion`;

  constructor(private http: HttpClient) {}

  /** Upload a file and enqueue conversion. Emits HttpEvents so callers can show upload progress. */
  convert(file: File, opts: ConvertOptions): Observable<HttpEvent<{ jobId: string; status: string }>> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', opts.name);
    if (opts.description) fd.append('description', opts.description);
    if (opts.modelType) fd.append('modelType', opts.modelType);
    fd.append('optimize', String(opts.optimize !== false));
    if (opts.simplifyRatio != null) fd.append('simplifyRatio', String(opts.simplifyRatio));
    fd.append('draco', String(!!opts.draco));
    if (opts.sourceUnit) fd.append('sourceUnit', opts.sourceUnit);
    if (opts.upAxis) fd.append('upAxis', opts.upAxis);

    const req = new HttpRequest('POST', `${this.base}/convert`, fd, { reportProgress: true });
    return this.http.request<{ jobId: string; status: string }>(req);
  }

  /** Upload multiple files and/or ZIP archives; enqueues one job per supported file. */
  convertBatch(
    files: File[],
    opts: ConvertOptions,
  ): Observable<HttpEvent<{ count: number; jobs: { id: string; originalName: string; status: string }[] }>> {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    if (opts.modelType) fd.append('modelType', opts.modelType);
    fd.append('optimize', String(opts.optimize !== false));
    if (opts.simplifyRatio != null) fd.append('simplifyRatio', String(opts.simplifyRatio));
    fd.append('draco', String(!!opts.draco));
    if (opts.sourceUnit) fd.append('sourceUnit', opts.sourceUnit);
    if (opts.upAxis) fd.append('upAxis', opts.upAxis);

    const req = new HttpRequest('POST', `${this.base}/convert-batch`, fd, { reportProgress: true });
    return this.http.request<{ count: number; jobs: { id: string; originalName: string; status: string }[] }>(req);
  }

  getJob(id: string): Observable<ConversionJob> {
    return this.http.get<ConversionJob>(`${this.base}/${id}`);
  }

  list(): Observable<ConversionJob[]> {
    return this.http.get<ConversionJob[]>(this.base);
  }

  getFormats(): Observable<SupportedFormats> {
    return this.http.get<SupportedFormats>(`${this.base}/formats`);
  }

  /** Direct download URL for the produced GLB (served by the models endpoint). */
  modelFileUrl(modelId: string): string {
    return `${environment.apiUrl}/models/${modelId}/file`;
  }

  /** Re-run a job (e.g. after a failure). */
  retry(id: string): Observable<{ jobId: string; status: string }> {
    return this.http.post<{ jobId: string; status: string }>(`${this.base}/${id}/retry`, {});
  }

  /** Pass/fail/warning counts for a set of model ids (for QA chips on cards). */
  qaSummaryBatch(
    modelIds: string[],
  ): Observable<Record<string, { total: number; pass: number; fail: number; warning: number }>> {
    return this.http.get<Record<string, { total: number; pass: number; fail: number; warning: number }>>(
      `${environment.apiUrl}/quality-data/summary-batch`,
      { params: { modelIds: modelIds.join(',') } },
    );
  }
}
