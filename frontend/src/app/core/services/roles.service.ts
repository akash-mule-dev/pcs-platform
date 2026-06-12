import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface PermissionActionDef {
  action: string;
  label: string;
  description: string;
  defaultRoles: string[];
}

export interface PermissionFeatureDef {
  key: string;
  label: string;
  category: string;
  /** Platform-scoped (cross-tenant) — not grantable to custom roles. */
  platform?: boolean;
  actions: PermissionActionDef[];
}

export interface PermissionCatalog {
  categories: string[];
  features: PermissionFeatureDef[];
  systemRolePermissions: Record<string, string[]>;
  wildcard: string;
}

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  organizationId: string | null;
  permissions: string[];
  userCount: number;
  createdAt: string;
}

export interface AssignableRole {
  id: string;
  name: string;
  isSystem: boolean;
  description: string | null;
}

/** Roles & fine-grained permissions API (backend /api/rbac). */
@Injectable({ providedIn: 'root' })
export class RolesApiService {
  private base = `${environment.apiUrl}/rbac`;

  constructor(private http: HttpClient) {}

  catalog(): Observable<PermissionCatalog> {
    return this.http.get<PermissionCatalog>(`${this.base}/catalog`);
  }

  list(): Observable<RoleView[]> {
    return this.http.get<RoleView[]>(`${this.base}/roles`);
  }

  assignable(): Observable<AssignableRole[]> {
    return this.http.get<AssignableRole[]>(`${this.base}/roles/assignable`);
  }

  get(id: string): Observable<RoleView> {
    return this.http.get<RoleView>(`${this.base}/roles/${id}`);
  }

  create(body: { name: string; description?: string; permissions: string[] }): Observable<RoleView> {
    return this.http.post<RoleView>(`${this.base}/roles`, body);
  }

  update(id: string, body: { name?: string; description?: string; permissions?: string[] }): Observable<RoleView> {
    return this.http.patch<RoleView>(`${this.base}/roles/${id}`, body);
  }

  duplicate(id: string, body: { name: string; description?: string }): Observable<RoleView> {
    return this.http.post<RoleView>(`${this.base}/roles/${id}/duplicate`, body);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/roles/${id}`);
  }
}
