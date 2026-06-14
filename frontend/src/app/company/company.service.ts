import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';

export interface CompanyProfile {
  legalName?: string;
  contactEmail?: string;
  phone?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  taxId?: string;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: string;
  isActive: boolean;
  profile: CompanyProfile;
  hasLogo: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The caller's own company profile (tenant-facing). */
@Injectable({ providedIn: 'root' })
export class CompanyApiService {
  constructor(private api: ApiService) {}

  get(): Observable<Company> { return this.api.get('/company'); }
  update(body: { name?: string; description?: string; profile?: CompanyProfile }): Observable<Company> {
    return this.api.patch('/company', body);
  }

  /** Fetch the company logo as an authed blob (for an object URL). */
  getLogo(): Observable<Blob> { return this.api.getBlob('/company/logo'); }

  /** Upload/replace the company logo (multipart). */
  uploadLogo(file: File): Observable<Company> {
    const form = new FormData();
    form.append('file', file);
    return this.api.postForm('/company/logo', form);
  }

  /** Remove the company logo. */
  removeLogo(): Observable<Company> { return this.api.delete('/company/logo'); }
}
