/**
 * Central role-based permissions — the single source of truth.
 * Served via GET /api/auth/permissions so frontend & mobile stay in sync.
 *
 * Each feature maps to { view: Role[], manage?: Role[] }.
 * - view:   roles that can see the feature / navigate to it
 * - manage: roles that can create / edit / delete (defaults to view if omitted)
 */

export type Role = 'admin' | 'manager' | 'supervisor' | 'operator';

export interface FeaturePermission {
  view: Role[];
  manage?: Role[];
}

export const PERMISSIONS: Record<string, FeaturePermission> = {
  dashboard:          { view: ['admin', 'manager', 'supervisor', 'operator'] },
  products:           { view: ['admin', 'manager', 'supervisor'], manage: ['admin', 'manager'] },
  processes:          { view: ['admin', 'manager', 'supervisor'], manage: ['admin', 'manager'] },
  'work-orders':      { view: ['admin', 'manager', 'supervisor', 'operator'], manage: ['admin', 'manager', 'supervisor'] },
  kanban:             { view: ['admin', 'manager', 'supervisor', 'operator'] },
  'time-tracking':    { view: ['admin', 'manager', 'supervisor', 'operator'] },
  users:              { view: ['admin', 'manager'], manage: ['admin'] },
  stations:           { view: ['admin', 'manager'], manage: ['admin', 'manager'] },
  coordination:       { view: ['admin', 'manager', 'supervisor'], manage: ['admin', 'manager'] },
  'quality-analysis': { view: ['admin', 'manager', 'supervisor'], manage: ['admin', 'manager', 'supervisor'] },
  reports:            { view: ['admin', 'manager', 'supervisor'] },
  audit:              { view: ['admin', 'manager'] },
};

/** Check if a role can view a feature */
export function canView(feature: string, role: string): boolean {
  const perm = PERMISSIONS[feature];
  if (!perm) return true;
  return perm.view.includes(role as Role);
}

/** Check if a role can manage (create/edit/delete) within a feature */
export function canManage(feature: string, role: string): boolean {
  const perm = PERMISSIONS[feature];
  if (!perm) return true;
  const allowed = perm.manage ?? perm.view;
  return allowed.includes(role as Role);
}
