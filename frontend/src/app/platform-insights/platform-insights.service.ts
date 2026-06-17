import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../core/services/api.service';

export type TenantStatus = 'active' | 'idle' | 'dormant';

export interface FeatureAdoption {
  key: string;
  label: string;
  category: string;
  tenantsUsing: number;
  totalRecords: number;
  adoptionPct: number;
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  description: string | null;
  createdAt: string;
  hasLogo: boolean;
  users: number;
  activeUsers: number;
  usersActive30d: number;
  records: Record<string, number>;
  featuresUsed: number;
  featuresTotal: number;
  events30d: number;
  events7d: number;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  status: TenantStatus;
}

export interface PlatformOverview {
  generatedAt: string;
  totals: {
    tenants: number;
    activeTenants: number;
    inactiveTenants: number;
    users: number;
    activeUsers: number;
    usersLoggedIn30d: number;
    activeLast30d: number;
    idleTenants: number;
    dormantTenants: number;
    dormantFeatures: number;
  };
  features: FeatureAdoption[];
  trend: { weekStart: string; events: number }[];
  tenants: TenantRow[];
}

export interface TenantInsight {
  organization: {
    id: string; name: string; slug: string; isActive: boolean;
    description: string | null; hasLogo: boolean; createdAt: string;
  };
  status: TenantStatus;
  users: { total: number; active: number; loggedIn30d: number; lastLoginAt: string | null; byRole: { role: string; count: number }[] };
  adoption: { featuresUsed: number; featuresTotal: number };
  features: { key: string; label: string; category: string; records: number; lastAt: string | null; used: boolean }[];
  activity: {
    lastActivityAt: string | null;
    events7d: number; events30d: number; events90d: number;
    trend: { weekStart: string; events: number }[];
    byType: { entityType: string; action: string; count: number }[];
    topUsers: { id: string; name: string; email: string | null; events: number; lastLoginAt: string | null }[];
  };
}

/** API layer for platform-level cross-tenant "Company Insights". */
@Injectable({ providedIn: 'root' })
export class PlatformInsightsService {
  constructor(private api: ApiService) {}

  overview(): Observable<PlatformOverview> {
    return this.api.get<any>('/platform/insights').pipe(map((r) => r?.data ?? r));
  }

  tenant(orgId: string): Observable<TenantInsight> {
    return this.api.get<any>(`/platform/insights/${orgId}`).pipe(map((r) => r?.data ?? r));
  }
}
