import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface CoordinationPackage {
  id: string;
  name: string;
  description: string | null;
  projectName: string | null;
  modelId: string | null;
  model: any | null;
  kssFileName: string | null;
  kssData: any | null;
  sourceFile: string | null;
  detailDrawingCount: number;
  erectionDrawingCount: number;
  status: 'processing' | 'ready' | 'error';
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Drawing {
  id: string;
  name: string;
  drawingNumber: string | null;
  revision: string | null;
  drawingType: 'detail' | 'erection' | 'general';
  fileName: string;
  originalName: string;
  fileSize: number;
  modelId: string | null;
  packageName: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class CoordinationApiService {
  private readonly base = `${environment.apiUrl}/coordination`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<CoordinationPackage[]> {
    return this.http.get<CoordinationPackage[]>(this.base);
  }

  getOne(id: string): Observable<CoordinationPackage> {
    return this.http.get<CoordinationPackage>(`${this.base}/${id}`);
  }

  getDrawings(packageId: string): Observable<Drawing[]> {
    return this.http.get<Drawing[]>(`${this.base}/${packageId}/drawings`);
  }

  getDrawingUrl(drawingId: string): string {
    return `${this.base}/drawings/${drawingId}/file`;
  }

  uploadZip(file: File, name: string, description?: string): Observable<HttpEvent<CoordinationPackage>> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    if (description) formData.append('description', description);

    const req = new HttpRequest('POST', `${this.base}/upload-zip`, formData, {
      reportProgress: true,
    });
    return this.http.request<CoordinationPackage>(req);
  }

  uploadFiles(files: File[], name: string, description?: string): Observable<HttpEvent<CoordinationPackage>> {
    const formData = new FormData();
    formData.append('name', name);
    if (description) formData.append('description', description);
    files.forEach(f => formData.append('files', f));

    const req = new HttpRequest('POST', `${this.base}/upload-files`, formData, {
      reportProgress: true,
    });
    return this.http.request<CoordinationPackage>(req);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
