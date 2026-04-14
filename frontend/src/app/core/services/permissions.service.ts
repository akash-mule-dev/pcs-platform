import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export interface FeaturePermission {
  view: string[];
  manage?: string[];
}

/**
 * Fetches the role-based permissions config from the backend (single source of truth)
 * and exposes canView / canManage helpers.
 *
 * The permissions are fetched once after login and cached in memory.
 */
@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private permissions: Record<string, FeaturePermission> = {};
  private loaded = false;

  constructor(private http: HttpClient, private auth: AuthService) {}

  /** Call this once after login to load permissions from the backend */
  load(): Promise<void> {
    if (!this.auth.token) return Promise.resolve();
    return new Promise((resolve) => {
      this.http.get<Record<string, FeaturePermission>>(
        `${environment.apiUrl}/auth/permissions`
      ).subscribe({
        next: (data) => {
          this.permissions = data;
          this.loaded = true;
          resolve();
        },
        error: () => {
          this.permissions = {};
          this.loaded = true;
          resolve();
        },
      });
    });
  }

  /** Check if the current user's role can view a feature */
  canView(feature: string): boolean {
    const perm = this.permissions[feature];
    if (!perm) return true;
    return perm.view.includes(this.auth.userRole);
  }

  /** Check if the current user's role can manage (create/edit/delete) within a feature */
  canManage(feature: string): boolean {
    const perm = this.permissions[feature];
    if (!perm) return true;
    const allowed = perm.manage ?? perm.view;
    return allowed.includes(this.auth.userRole);
  }

  get isLoaded(): boolean {
    return this.loaded;
  }
}
