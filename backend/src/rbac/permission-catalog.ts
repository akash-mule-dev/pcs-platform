/**
 * Fine-grained permission catalog — the single source of truth for WHAT can be
 * controlled in the platform.
 *
 * Pure module (no Nest/TypeORM imports) so it is unit-testable in isolation and
 * its shape can be mirrored by the web / mobile clients.
 *
 * Model (industry standard):
 *  - A permission is a `<feature>.<action>` string (e.g. `work-orders.execute`).
 *  - The catalog (features × actions, grouped by category) is defined in code,
 *    because the enforcing code must know every permission anyway.
 *  - WHO holds a permission lives in the database: system roles get the code
 *    defaults below; custom (per-organization) roles get explicit grant rows.
 *  - `*` is the TENANT super-user wildcard (system admin): every permission of
 *    every non-platform feature. `<feature>.*` grants every action of one
 *    feature. Custom roles must enumerate permissions — wildcards are reserved
 *    for system roles.
 *  - Features flagged `platform: true` are PLATFORM-scoped (cross-tenant
 *    provisioning). They are excluded from `*`, cannot be granted to custom
 *    roles, and belong only to the org-less `platform-admin` system role — so
 *    one tenant's admin can never manage other tenants.
 */

export const WILDCARD = '*';

export type SystemRoleName = 'admin' | 'manager' | 'supervisor' | 'operator' | 'platform-admin';
export const SYSTEM_ROLE_NAMES: SystemRoleName[] = ['admin', 'manager', 'supervisor', 'operator', 'platform-admin'];

/** The org-less platform operator role — manages organizations, not shop-floor work. */
export const PLATFORM_ADMIN_ROLE_NAME = 'platform-admin';

/** Non-admin roles an action is granted to by default (admin always has `*`). */
type DefaultRoles = ReadonlyArray<Exclude<SystemRoleName, 'admin'>>;

export interface PermissionActionDef {
  /** Action part of the permission key. */
  action: string;
  label: string;
  description: string;
  /** System roles (besides admin) holding this permission by default. */
  defaultRoles: DefaultRoles;
}

export interface PermissionFeatureDef {
  /** Feature part of the permission key — matches frontend feature/route keys. */
  key: string;
  label: string;
  category: string;
  /** Platform-scoped (cross-tenant): excluded from `*`, custom roles can't hold it. */
  platform?: boolean;
  actions: PermissionActionDef[];
}

const MSO: DefaultRoles = ['manager', 'supervisor', 'operator'];
const MS: DefaultRoles = ['manager', 'supervisor'];
const M: DefaultRoles = ['manager'];
const NONE: DefaultRoles = [];

export const PERMISSION_CATALOG: PermissionFeatureDef[] = [
  // ── General ────────────────────────────────────────────────────────────────
  {
    key: 'dashboard', label: 'Dashboard', category: 'General',
    actions: [
      { action: 'view', label: 'View', description: 'See the production dashboard and live status', defaultRoles: MSO },
      { action: 'analytics', label: 'Analytics', description: 'Operator performance, stage analytics and OEE', defaultRoles: MS },
      { action: 'export', label: 'Export', description: 'Export dashboard data', defaultRoles: M },
    ],
  },
  {
    key: 'reports', label: 'Reports', category: 'General',
    actions: [
      { action: 'view', label: 'View', description: 'Open the analytics reports', defaultRoles: MS },
    ],
  },
  {
    key: 'audit', label: 'Audit Log', category: 'General',
    actions: [
      { action: 'view', label: 'View', description: 'Read the audit trail', defaultRoles: M },
    ],
  },

  // ── Production ─────────────────────────────────────────────────────────────
  {
    key: 'projects', label: 'Projects', category: 'Production',
    actions: [
      { action: 'view', label: 'View', description: 'Browse projects, assembly trees and 3D models', defaultRoles: MSO },
      { action: 'create', label: 'Create', description: 'Create projects', defaultRoles: M },
      { action: 'update', label: 'Edit', description: 'Edit project details', defaultRoles: M },
      { action: 'delete', label: 'Delete', description: 'Delete projects', defaultRoles: NONE },
      { action: 'import', label: 'Import IFC', description: 'Import IFC/CAD files into a project', defaultRoles: M },
    ],
  },
  {
    key: 'production-orders', label: 'Production Orders', category: 'Production',
    actions: [
      { action: 'view', label: 'View', description: 'See orders, stage boards, progress and audit trails', defaultRoles: MSO },
      { action: 'create', label: 'Create', description: 'Create and release production orders', defaultRoles: M },
      { action: 'update', label: 'Edit', description: 'Edit production order details and status', defaultRoles: MS },
      { action: 'delete', label: 'Delete', description: 'Delete production orders', defaultRoles: M },
      { action: 'execute', label: 'Execute stages', description: 'Step stage counts on the order board', defaultRoles: MSO },
    ],
  },
  {
    key: 'work-orders', label: 'Work Orders', category: 'Production',
    actions: [
      { action: 'view', label: 'View', description: 'Browse work orders and their stages', defaultRoles: MSO },
      { action: 'create', label: 'Create', description: 'Create work orders', defaultRoles: MS },
      { action: 'update', label: 'Edit', description: 'Edit, assign and change work order status', defaultRoles: MS },
      { action: 'bulk-update', label: 'Bulk update', description: 'Batch status / line assignment', defaultRoles: M },
      { action: 'execute', label: 'Execute stages', description: 'Update stage status on the shop floor', defaultRoles: MSO },
      { action: 'delete', label: 'Delete', description: 'Delete work orders', defaultRoles: NONE },
    ],
  },
  {
    key: 'kanban', label: 'Kanban Board', category: 'Production',
    actions: [
      { action: 'view', label: 'View', description: 'See the kanban board', defaultRoles: MSO },
    ],
  },
  {
    key: 'processes', label: 'Processes', category: 'Production',
    actions: [
      { action: 'view', label: 'View', description: 'Browse processes and stage routings', defaultRoles: MS },
      { action: 'create', label: 'Create', description: 'Create processes', defaultRoles: M },
      { action: 'update', label: 'Edit', description: 'Edit processes and their stages', defaultRoles: M },
      { action: 'delete', label: 'Delete', description: 'Delete processes', defaultRoles: NONE },
    ],
  },
  {
    key: 'scheduling', label: 'Capacity & Scheduling', category: 'Production',
    actions: [
      { action: 'view', label: 'View', description: 'See capacity load and schedules', defaultRoles: MS },
    ],
  },
  {
    key: 'costing', label: 'Costing', category: 'Production',
    actions: [
      { action: 'view', label: 'View', description: 'See work order cost breakdowns and material requirements', defaultRoles: MS },
      { action: 'manage', label: 'Manage settings', description: 'Edit costing settings (default labor rate, overhead %, currency)', defaultRoles: M },
    ],
  },

  // ── Shop Floor ─────────────────────────────────────────────────────────────
  {
    key: 'time-tracking', label: 'Time Tracking', category: 'Shop Floor',
    actions: [
      { action: 'view', label: 'View', description: 'See active sessions and own history', defaultRoles: MSO },
      { action: 'track', label: 'Clock in/out', description: 'Clock in and out of work order stages', defaultRoles: MSO },
      { action: 'manage', label: 'Manage', description: "View and correct other users' time entries", defaultRoles: MS },
    ],
  },
  {
    key: 'stations', label: 'Lines & Stations', category: 'Shop Floor',
    actions: [
      { action: 'view', label: 'View', description: 'Browse production lines and stations', defaultRoles: MSO },
      { action: 'manage', label: 'Manage', description: 'Create and edit lines and stations', defaultRoles: M },
      { action: 'delete', label: 'Delete lines', description: 'Delete production lines', defaultRoles: NONE },
    ],
  },
  {
    key: 'equipment', label: 'Equipment', category: 'Shop Floor',
    actions: [
      { action: 'view', label: 'View', description: 'Browse equipment, effectiveness and downtime', defaultRoles: MSO },
      { action: 'operate', label: 'Change status', description: 'Change equipment operational status', defaultRoles: MS },
      { action: 'report-downtime', label: 'Report downtime', description: 'Open and close downtime events', defaultRoles: MSO },
      { action: 'maintain', label: 'Maintenance orders', description: 'Create and update maintenance orders', defaultRoles: MS },
      { action: 'manage', label: 'Manage', description: 'Create/edit equipment and maintenance plans', defaultRoles: M },
      { action: 'delete', label: 'Delete', description: 'Delete equipment', defaultRoles: NONE },
    ],
  },
  {
    key: 'workforce', label: 'Workforce', category: 'Shop Floor',
    actions: [
      { action: 'view', label: 'View', description: 'See attendance, shifts and skills', defaultRoles: MSO },
      { action: 'assign', label: 'Assign', description: 'Record attendance, assign shifts and skills', defaultRoles: MS },
      { action: 'manage', label: 'Manage', description: 'Define shifts and the skill catalog', defaultRoles: M },
    ],
  },

  // ── Materials ──────────────────────────────────────────────────────────────
  {
    key: 'materials', label: 'Materials & Inventory', category: 'Materials',
    actions: [
      { action: 'view', label: 'View', description: 'Browse materials, stock and movements', defaultRoles: MSO },
      { action: 'transact', label: 'Receive / issue', description: 'Receive, issue and scrap stock', defaultRoles: MS },
      { action: 'manage', label: 'Manage', description: 'Create/edit materials, adjust stock', defaultRoles: M },
      { action: 'delete', label: 'Delete', description: 'Delete materials', defaultRoles: NONE },
    ],
  },
  {
    key: 'traceability', label: 'Traceability', category: 'Materials',
    actions: [
      { action: 'view', label: 'View', description: 'Look up lots, serials and genealogy', defaultRoles: MSO },
      { action: 'record', label: 'Record', description: 'Create lots/serials and link genealogy', defaultRoles: MS },
    ],
  },

  // ── Quality ────────────────────────────────────────────────────────────────
  {
    key: 'quality-reports', label: 'QC Reports', category: 'Quality',
    actions: [
      { action: 'view', label: 'View', description: 'Read QC reports and per-order quality summaries', defaultRoles: MSO },
      { action: 'create', label: 'Create', description: 'Start QC reports from a template', defaultRoles: MSO },
      { action: 'update', label: 'Fill & submit', description: 'Fill in and submit QC reports', defaultRoles: MSO },
      { action: 'delete', label: 'Delete', description: 'Delete QC reports', defaultRoles: M },
    ],
  },
  {
    key: 'templates', label: 'Report Templates', category: 'Quality',
    actions: [
      { action: 'view', label: 'View', description: 'Browse report templates', defaultRoles: MSO },
      { action: 'manage', label: 'Manage', description: 'Create, edit and delete templates', defaultRoles: M },
    ],
  },
  {
    key: 'quality-analysis', label: '3D Quality', category: 'Quality',
    actions: [
      { action: 'view', label: 'View', description: 'See 3D quality data, trends and SPC charts', defaultRoles: MS },
      { action: 'inspect', label: 'Inspect', description: 'Record inspections and attach evidence', defaultRoles: MS },
      { action: 'signoff', label: 'Sign off', description: 'Approve / reject failed inspections', defaultRoles: MS },
      { action: 'delete', label: 'Delete', description: 'Delete quality data', defaultRoles: M },
    ],
  },

  // ── Engineering ────────────────────────────────────────────────────────────
  {
    key: 'coordination', label: 'BIM Coordination', category: 'Engineering',
    actions: [
      { action: 'view', label: 'View', description: 'Browse coordination packages and drawings', defaultRoles: MS },
      { action: 'manage', label: 'Manage', description: 'Upload packages, manage 3D models', defaultRoles: M },
      { action: 'convert', label: 'Convert CAD', description: 'Run 3D/CAD conversions', defaultRoles: M },
      { action: 'delete', label: 'Delete', description: 'Delete packages and models', defaultRoles: NONE },
    ],
  },
  {
    key: 'shipping', label: 'Shipping', category: 'Engineering',
    actions: [
      { action: 'view', label: 'View', description: 'See shipments and loaded assemblies', defaultRoles: MSO },
      { action: 'manage', label: 'Manage', description: 'Create shipments, load items, update status', defaultRoles: M },
      { action: 'delete', label: 'Delete', description: 'Delete shipments', defaultRoles: NONE },
    ],
  },

  // ── Administration ─────────────────────────────────────────────────────────
  {
    key: 'users', label: 'Users', category: 'Administration',
    actions: [
      { action: 'view', label: 'View', description: 'Browse the user directory', defaultRoles: M },
      { action: 'create', label: 'Create', description: 'Create user accounts', defaultRoles: NONE },
      { action: 'update', label: 'Edit', description: 'Edit users, reset passwords, assign roles', defaultRoles: NONE },
      { action: 'delete', label: 'Deactivate', description: 'Deactivate user accounts', defaultRoles: NONE },
    ],
  },
  {
    key: 'roles', label: 'Roles & Permissions', category: 'Administration',
    actions: [
      { action: 'view', label: 'View', description: 'See roles and their permissions', defaultRoles: M },
      { action: 'create', label: 'Create', description: 'Create custom roles', defaultRoles: NONE },
      { action: 'update', label: 'Edit', description: "Change custom roles' permissions", defaultRoles: NONE },
      { action: 'delete', label: 'Delete', description: 'Delete custom roles', defaultRoles: NONE },
    ],
  },
  {
    key: 'company', label: 'Company Info', category: 'Administration',
    actions: [
      { action: 'view', label: 'View', description: "See this company's profile (name, contact, address)", defaultRoles: MS },
      { action: 'manage', label: 'Edit', description: "Edit this company's profile details", defaultRoles: NONE },
    ],
  },
  {
    key: 'support', label: 'Support', category: 'General',
    actions: [
      { action: 'view', label: 'View', description: "See this company's support tickets", defaultRoles: MSO },
      { action: 'create', label: 'Raise ticket', description: 'Contact support / open a ticket', defaultRoles: MSO },
      { action: 'comment', label: 'Reply', description: 'Reply on a support ticket', defaultRoles: MSO },
    ],
  },
  // ── Platform (cross-tenant — held only by platform-admin) ─────────────────
  {
    key: 'organizations', label: 'Organizations', category: 'Platform', platform: true,
    actions: [
      { action: 'view', label: 'View', description: 'See all tenant organizations (platform operators)', defaultRoles: NONE },
      { action: 'manage', label: 'Manage', description: 'Provision and edit tenant organizations (platform operators)', defaultRoles: NONE },
      { action: 'impersonate', label: 'Support login', description: 'Open a time-limited support session inside a tenant to investigate issues', defaultRoles: NONE },
    ],
  },
  {
    key: 'library', label: 'Shared Library', category: 'Platform', platform: true,
    actions: [
      { action: 'view', label: 'View', description: 'Browse the shared library of default processes & templates', defaultRoles: NONE },
      { action: 'manage', label: 'Manage', description: 'Author and edit shared library content', defaultRoles: NONE },
      { action: 'publish', label: 'Publish', description: 'Publish library content into tenant organizations', defaultRoles: NONE },
    ],
  },
  {
    key: 'support-desk', label: 'Support Desk', category: 'Platform', platform: true,
    actions: [
      { action: 'view', label: 'View', description: 'See support tickets across all tenants', defaultRoles: NONE },
      { action: 'manage', label: 'Manage', description: 'Reply, assign, change status and add internal notes', defaultRoles: NONE },
    ],
  },
  {
    key: 'platform-insights', label: 'Company Insights', category: 'Platform', platform: true,
    actions: [
      { action: 'view', label: 'View', description: 'See cross-tenant adoption & usage analytics (how each company uses the system, which features are dormant)', defaultRoles: NONE },
    ],
  },
];

/** Ordered list of category names (UI grouping). */
export const PERMISSION_CATEGORIES: string[] = [...new Set(PERMISSION_CATALOG.map((f) => f.category))];

/** Every concrete permission key in the catalog (no wildcards). */
export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.flatMap((f) =>
  f.actions.map((a) => `${f.key}.${a.action}`),
);

/** Platform-scoped keys: excluded from `*`, never grantable to custom roles. */
export const PLATFORM_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.filter((f) => f.platform).flatMap(
  (f) => f.actions.map((a) => `${f.key}.${a.action}`),
);

/** Tenant-scoped keys — what the `*` wildcard expands to. */
export const TENANT_PERMISSION_KEYS: string[] = ALL_PERMISSION_KEYS.filter(
  (k) => !PLATFORM_PERMISSION_KEYS.includes(k),
);

const ALL_KEY_SET: ReadonlySet<string> = new Set(ALL_PERMISSION_KEYS);
const PLATFORM_KEY_SET: ReadonlySet<string> = new Set(PLATFORM_PERMISSION_KEYS);
const PLATFORM_FEATURE_SET: ReadonlySet<string> = new Set(
  PERMISSION_CATALOG.filter((f) => f.platform).map((f) => f.key),
);

export function isPlatformPermission(key: string): boolean {
  if (PLATFORM_KEY_SET.has(key)) return true;
  return key.endsWith('.*') && PLATFORM_FEATURE_SET.has(key.slice(0, -2));
}

/**
 * Default permission sets for the built-in system roles.
 * Tenant admin gets `*` (everything except platform features); the org-less
 * platform-admin additionally holds the platform keys explicitly.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleName, string[]> = {
  admin: [WILDCARD],
  manager: defaultsFor('manager'),
  supervisor: defaultsFor('supervisor'),
  operator: defaultsFor('operator'),
  [PLATFORM_ADMIN_ROLE_NAME]: [WILDCARD, ...PLATFORM_PERMISSION_KEYS],
};

function defaultsFor(role: Exclude<SystemRoleName, 'admin' | 'platform-admin'>): string[] {
  return PERMISSION_CATALOG.filter((f) => !f.platform).flatMap((f) =>
    f.actions.filter((a) => a.defaultRoles.includes(role)).map((a) => `${f.key}.${a.action}`),
  );
}

/** Is this a concrete permission defined in the catalog? */
export function isKnownPermission(key: string): boolean {
  return ALL_KEY_SET.has(key);
}

/** Is this string valid as a stored grant (concrete key or wildcard forms)? */
export function isValidGrant(key: string): boolean {
  if (key === WILDCARD) return true;
  if (key.endsWith('.*')) return PERMISSION_CATALOG.some((f) => f.key === key.slice(0, -2));
  return isKnownPermission(key);
}

/**
 * Core check: does a granted set satisfy one required permission?
 * `*` covers every TENANT permission (platform features are excluded — they
 * need an explicit grant or `<platform-feature>.*`); `<feature>.*` covers
 * every action of one feature.
 */
export function hasPermission(granted: ReadonlySet<string>, required: string): boolean {
  if (granted.has(WILDCARD) && !isPlatformPermission(required)) return true;
  if (granted.has(required)) return true;
  const dot = required.lastIndexOf('.');
  if (dot > 0 && granted.has(`${required.slice(0, dot)}.*`)) return true;
  return false;
}

/**
 * Expand wildcards into concrete catalog keys (used when duplicating roles).
 * `*` expands to TENANT keys only — duplicating an admin-ish role must never
 * leak platform permissions into a tenant custom role.
 */
export function expandGrants(granted: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const g of granted) {
    if (g === WILDCARD) {
      TENANT_PERMISSION_KEYS.forEach((k) => set.add(k));
      continue;
    }
    if (g.endsWith('.*')) {
      const feature = PERMISSION_CATALOG.find((f) => f.key === g.slice(0, -2));
      feature?.actions.forEach((a) => set.add(`${feature.key}.${a.action}`));
    } else if (ALL_KEY_SET.has(g)) {
      set.add(g);
    }
  }
  return [...set];
}

/** Dedupe + drop unknown keys (defensive when reading stored grants). */
export function sanitizeGrants(granted: Iterable<string>): string[] {
  return [...new Set([...granted].filter(isValidGrant))];
}
