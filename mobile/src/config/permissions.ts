/**
 * Central role-based permissions for mobile app.
 * Controls which tabs and actions are visible to each role.
 */

export type Role = 'admin' | 'manager' | 'supervisor' | 'operator';

/** Tab keys matching the TabNavigator screen names */
export type TabKey = 'Dashboard' | 'WorkOrders' | 'Timer' | 'Models' | 'Profile';

/** Which roles can see each tab */
export const TAB_PERMISSIONS: Record<TabKey, Role[]> = {
  Dashboard:  ['admin', 'manager', 'supervisor', 'operator'],
  WorkOrders: ['admin', 'manager', 'supervisor', 'operator'],
  Timer:      ['admin', 'manager', 'supervisor', 'operator'],
  Models:     ['admin', 'manager', 'supervisor'],
  Profile:    ['admin', 'manager', 'supervisor', 'operator'],
};

export function canViewTab(tab: TabKey, role: string): boolean {
  const allowed = TAB_PERMISSIONS[tab];
  return allowed ? allowed.includes(role as Role) : true;
}
