import { api } from '../services/api.service';

export type Role = 'admin' | 'manager' | 'supervisor' | 'operator';
export type TabKey = 'Dashboard' | 'WorkOrders' | 'Timer' | 'Models' | 'Profile';

export interface FeaturePermission {
  view: string[];
  manage?: string[];
}

/** Maps tab names to the backend feature keys used in the permissions config */
const TAB_FEATURE_MAP: Record<TabKey, string> = {
  Dashboard:  'dashboard',
  WorkOrders: 'work-orders',
  Timer:      'time-tracking',
  Models:     'quality-analysis',
  Profile:    '_always_visible',
};

let _permissions: Record<string, FeaturePermission> = {};
let _loaded = false;

/** Fetch permissions from the backend and cache in memory */
export async function loadPermissions(): Promise<void> {
  try {
    const data = await api.get<Record<string, FeaturePermission>>('/auth/permissions');
    _permissions = data;
    _loaded = true;
  } catch {
    _permissions = {};
    _loaded = true;
  }
}

export function isPermissionsLoaded(): boolean {
  return _loaded;
}

export function canView(feature: string, role: string): boolean {
  const perm = _permissions[feature];
  if (!perm) return true;
  return perm.view.includes(role);
}

export function canManage(feature: string, role: string): boolean {
  const perm = _permissions[feature];
  if (!perm) return true;
  const allowed = perm.manage ?? perm.view;
  return allowed.includes(role);
}

export function canViewTab(tab: TabKey, role: string): boolean {
  const feature = TAB_FEATURE_MAP[tab];
  if (!feature || feature === '_always_visible') return true;
  return canView(feature, role);
}
