import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export interface MyAccess {
  role: { id: string; name: string; isSystem: boolean };
  /** Fine-grained permission keys; `*` = everything (system admin). */
  permissions: string[];
}

const WILDCARD = '*';
const PLATFORM_FEATURES = new Set(['organizations', 'library', 'platform-insights']);

/**
 * The caller's effective fine-grained permissions, fetched from the backend
 * (single source of truth) after login and cached in memory.
 *
 * Checks:
 *  - can('work-orders.execute')  — exact, fine-grained (wildcard-aware)
 *  - canView('work-orders')      — sugar for `<feature>.view`
 *  - canManage('work-orders')    — true if the user holds ANY non-view action
 *                                  of the feature (create/update/delete/…)
 */
@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private granted = new Set<string>();
  private role: MyAccess['role'] | null = null;
  private loadedForToken: string | null = null;

  constructor(private http: HttpClient, private auth: AuthService) {}

  /** Load (or re-load after a user switch) the caller's permission set. */
  load(): Promise<void> {
    const token = this.auth.token;
    if (!token) return Promise.resolve();
    return new Promise((resolve) => {
      this.http.get<MyAccess>(`${environment.apiUrl}/auth/permissions`).subscribe({
        next: (data) => {
          this.granted = new Set(data?.permissions ?? []);
          this.role = data?.role ?? null;
          this.loadedForToken = token;
          resolve();
        },
        error: () => {
          this.granted = new Set();
          this.role = null;
          this.loadedForToken = token;
          resolve();
        },
      });
    });
  }

  /** Re-fetch (e.g. after roles were edited). */
  reload(): Promise<void> {
    this.loadedForToken = null;
    return this.load();
  }

  clear(): void {
    this.granted = new Set();
    this.role = null;
    this.loadedForToken = null;
  }

  /** Loaded for the CURRENT session? (false after login as a different user) */
  get isLoaded(): boolean {
    return this.loadedForToken !== null && this.loadedForToken === this.auth.token;
  }

  get currentRole(): MyAccess['role'] | null {
    return this.role;
  }

  get allGranted(): string[] {
    return [...this.granted].sort();
  }

  /** Fine-grained check: does the user hold this `<feature>.<action>` permission? */
  can(permission: string): boolean {
    const feature = permission.slice(0, permission.lastIndexOf('.'));
    if (this.granted.has(WILDCARD) && !PLATFORM_FEATURES.has(feature)) return true;
    if (this.granted.has(permission)) return true;
    const dot = permission.lastIndexOf('.');
    return dot > 0 && this.granted.has(`${permission.slice(0, dot)}.*`);
  }

  canAny(...permissions: string[]): boolean {
    return permissions.some((p) => this.can(p));
  }

  canAll(...permissions: string[]): boolean {
    return permissions.every((p) => this.can(p));
  }

  /** Can the user see a feature (drives nav + route guards)? */
  canView(feature: string): boolean {
    return this.can(`${feature}.view`);
  }

  /**
   * Coarse "can do more than look" check kept for existing call sites:
   * true when the user holds any non-view action of the feature.
   * Prefer can('<feature>.<action>') for new, fine-grained gating.
   */
  canManage(feature: string): boolean {
    if (this.granted.has(WILDCARD) && !PLATFORM_FEATURES.has(feature)) return true;
    if (this.granted.has(`${feature}.*`)) return true;
    const prefix = `${feature}.`;
    for (const p of this.granted) {
      if (p.startsWith(prefix) && p !== `${feature}.view`) return true;
    }
    return false;
  }
}
