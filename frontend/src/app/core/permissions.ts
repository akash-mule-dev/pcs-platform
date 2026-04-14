/**
 * Central role-based permissions config.
 * Used by: sidebar nav, route guards, action-button visibility.
 *
 * If a feature is NOT listed here, it is accessible to ALL authenticated users.
 * If a feature IS listed, only the specified roles may access it.
 */

export type Role = 'admin' | 'manager' | 'supervisor' | 'operator';

export interface FeaturePermission {
  /** Roles allowed to view / navigate to this feature */
  view: Role[];
  /** Roles allowed to create / edit / delete (mutate) within this feature.
   *  Falls back to `view` if omitted. */
  manage?: Role[];
}

export const PERMISSIONS: Record<string, FeaturePermission> = {
  dashboard:      { view: ['admin', 'manager', 'supervisor', 'operator'] },
  products:       { view: ['admin', 'manager', 'supervisor'], manage: ['admin', 'manager'] },
  processes:      { view: ['admin', 'manager', 'supervisor'], manage: ['admin', 'manager'] },
  'work-orders':  { view: ['admin', 'manager', 'supervisor', 'operator'], manage: ['admin', 'manager', 'supervisor'] },
  kanban:         { view: ['admin', 'manager', 'supervisor', 'operator'] },
  'time-tracking':{ view: ['admin', 'manager', 'supervisor', 'operator'] },
  users:          { view: ['admin', 'manager'], manage: ['admin'] },
  stations:       { view: ['admin', 'manager'], manage: ['admin', 'manager'] },
  coordination:   { view: ['admin', 'manager', 'supervisor'], manage: ['admin', 'manager'] },
  'quality-analysis': { view: ['admin', 'manager', 'supervisor'], manage: ['admin', 'manager', 'supervisor'] },
  reports:        { view: ['admin', 'manager', 'supervisor'] },
  audit:          { view: ['admin', 'manager'] },
};

/** Check if a role can view a feature */
export function canView(feature: string, role: string): boolean {
  const perm = PERMISSIONS[feature];
  if (!perm) return true; // no restriction defined = open to all
  return perm.view.includes(role as Role);
}

/** Check if a role can manage (create/edit/delete) within a feature */
export function canManage(feature: string, role: string): boolean {
  const perm = PERMISSIONS[feature];
  if (!perm) return true;
  const allowed = perm.manage ?? perm.view;
  return allowed.includes(role as Role);
}
