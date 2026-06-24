import { api } from '../services/api.service';

/**
 * Fine-grained permissions (mirrors the web portal):
 * the backend returns the CALLER's effective permission set — `<feature>.<action>`
 * keys, where `*` means everything (system admin) and `<feature>.*` a whole
 * feature. Roles (incl. org-defined custom roles) are resolved server-side, so
 * the app never hardcodes role names.
 */
export type Role = string;
export type TabKey = 'Dashboard' | 'Projects' | 'WorkOrders' | 'Timer' | 'More' | 'Profile';

export interface MyAccess {
  role: { id: string; name: string; isSystem: boolean };
  permissions: string[];
}

/** Maps tab names to the backend feature keys used in the permission catalog */
const TAB_FEATURE_MAP: Record<TabKey, string> = {
  Dashboard:  'dashboard',
  Projects:   'projects',
  WorkOrders: 'work-orders',
  Timer:      'time-tracking',
  More:       '_always_visible',
  Profile:    '_always_visible',
};

const WILDCARD = '*';

let _granted = new Set<string>();
let _role: MyAccess['role'] | null = null;
let _loaded = false;

/** Fetch the caller's permission set from the backend and cache in memory */
export async function loadPermissions(): Promise<void> {
  try {
    const data = await api.get<MyAccess>('/auth/permissions');
    _granted = new Set(data?.permissions ?? []);
    _role = data?.role ?? null;
    _loaded = true;
  } catch {
    _granted = new Set();
    _role = null;
    _loaded = true;
  }
}

export function clearPermissions(): void {
  _granted = new Set();
  _role = null;
  _loaded = false;
}

export function isPermissionsLoaded(): boolean {
  return _loaded;
}

export function currentRole(): MyAccess['role'] | null {
  return _role;
}

/** The caller's granted permission keys (the server-expanded set). `['*']` for
 *  full-access admins. Used by the Profile screen to summarise what you can access. */
export function grantedPermissions(): string[] {
  return [..._granted];
}

/** True when the user holds blanket access (the tenant/system `*` wildcard). */
export function hasFullAccess(): boolean {
  return _granted.has(WILDCARD);
}

/** Fine-grained check: does the user hold `<feature>.<action>`? (wildcard-aware) */
export function can(permission: string): boolean {
  if (_granted.has(WILDCARD) || _granted.has(permission)) return true;
  const dot = permission.lastIndexOf('.');
  return dot > 0 && _granted.has(`${permission.slice(0, dot)}.*`);
}

/**
 * Can the user see a feature? The `_role` argument is no longer used for the
 * decision (permissions are per-user from the server) — kept so existing call
 * sites stay source-compatible.
 */
export function canView(feature: string, _role?: string): boolean {
  return can(`${feature}.view`);
}

/** Does the user hold any non-view action of the feature (create/update/…)? */
export function canManage(feature: string, _role?: string): boolean {
  if (_granted.has(WILDCARD) || _granted.has(`${feature}.*`)) return true;
  const prefix = `${feature}.`;
  for (const p of _granted) {
    if (p.startsWith(prefix) && p !== `${feature}.view`) return true;
  }
  return false;
}

export function canViewTab(tab: TabKey, _role?: string): boolean {
  const feature = TAB_FEATURE_MAP[tab];
  if (!feature || feature === '_always_visible') return true;
  return canView(feature);
}
