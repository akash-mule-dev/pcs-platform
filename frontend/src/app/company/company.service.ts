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
}
