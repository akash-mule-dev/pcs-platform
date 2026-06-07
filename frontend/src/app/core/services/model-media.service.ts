import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Model thumbnail URLs + client-captured thumbnail upload. */
@Injectable({ providedIn: 'root' })
export class ModelMediaService {
  private readonly base = `${environment.apiUrl}/models`;

  constructor(private http: HttpClient) {}

  thumbnailUrl(modelId: string): string {
    return `${this.base}/${modelId}/thumbnail`;
  }

  uploadThumbnail(modelId: string, blob: Blob): Observable<unknown> {
    const fd = new FormData();
    fd.append('file', blob, `${modelId}.png`);
    return this.http.post(`${this.base}/${modelId}/thumbnail`, fd);
  }
}
