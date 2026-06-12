/**
 * Unit tests for the pure permission catalog & matching logic.
 * Run directly (no Nest/TypeORM needed):
 *   node --experimental-strip-types src/rbac/permission-catalog.test.ts
 */
import assert from 'node:assert/strict';
import {
  ALL_PERMISSION_KEYS,
  expandGrants,
  hasPermission,
  isKnownPermission,
  isPlatformPermission,
  isValidGrant,
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  PLATFORM_ADMIN_ROLE_NAME,
  PLATFORM_PERMISSION_KEYS,
  sanitizeGrants,
  SYSTEM_ROLE_PERMISSIONS,
  TENANT_PERMISSION_KEYS,
  WILDCARD,
} from './permission-catalog.ts';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('permission-catalog');

ok('catalog has no duplicate permission keys', () => {
  assert.equal(new Set(ALL_PERMISSION_KEYS).size, ALL_PERMISSION_KEYS.length);
});

ok('catalog keys are well-formed <feature>.<action>', () => {
  for (const key of ALL_PERMISSION_KEYS) {
    assert.match(key, /^[a-z0-9-]+\.[a-z0-9-]+$/, `malformed key: ${key}`);
  }
});

ok('every feature has a view action and a category', () => {
  for (const f of PERMISSION_CATALOG) {
    assert.ok(f.actions.some((a) => a.action === 'view'), `${f.key} lacks a view action`);
    assert.ok(PERMISSION_CATEGORIES.includes(f.category));
  }
});

ok('system role defaults only contain known permissions', () => {
  for (const [role, perms] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
    for (const p of perms) {
      assert.ok(p === WILDCARD || isKnownPermission(p), `${role} grants unknown ${p}`);
    }
  }
});

ok('admin is wildcard; manager ⊇ supervisor-defaults are sane', () => {
  assert.deepEqual(SYSTEM_ROLE_PERMISSIONS.admin, [WILDCARD]);
  const manager = new Set(SYSTEM_ROLE_PERMISSIONS.manager);
  // Spot-checks that mirror the legacy role behavior:
  assert.ok(manager.has('users.view'));
  assert.ok(!manager.has('users.create'));
  assert.ok(!manager.has('organizations.view'));
  assert.ok(manager.has('work-orders.bulk-update'));
  const supervisor = new Set(SYSTEM_ROLE_PERMISSIONS.supervisor);
  assert.ok(supervisor.has('work-orders.execute'));
  assert.ok(supervisor.has('quality-analysis.inspect'));
  assert.ok(!supervisor.has('projects.import'));
  assert.ok(!supervisor.has('roles.view'));
  const operator = new Set(SYSTEM_ROLE_PERMISSIONS.operator);
  assert.ok(operator.has('work-orders.execute'));
  assert.ok(operator.has('time-tracking.track'));
  assert.ok(operator.has('quality-reports.create'));
  assert.ok(!operator.has('work-orders.create'));
  assert.ok(!operator.has('quality-analysis.view'));
});

ok('hasPermission: exact, wildcard, feature wildcard, miss', () => {
  assert.ok(hasPermission(new Set(['work-orders.view']), 'work-orders.view'));
  assert.ok(hasPermission(new Set([WILDCARD]), 'anything.at-all'));
  assert.ok(hasPermission(new Set(['work-orders.*']), 'work-orders.execute'));
  assert.ok(!hasPermission(new Set(['work-orders.view']), 'work-orders.execute'));
  assert.ok(!hasPermission(new Set(), 'users.view'));
  assert.ok(!hasPermission(new Set(['work.orders.view']), 'work-orders.view'));
});

ok('platform separation: tenant wildcard never grants platform permissions', () => {
  assert.ok(PLATFORM_PERMISSION_KEYS.includes('organizations.manage'));
  assert.ok(isPlatformPermission('organizations.manage'));
  assert.ok(isPlatformPermission('organizations.*'));
  assert.ok(!isPlatformPermission('users.delete'));
  // Tenant admin (`*`) is NOT a platform operator:
  assert.ok(!hasPermission(new Set([WILDCARD]), 'organizations.manage'));
  assert.ok(!hasPermission(new Set([WILDCARD]), 'organizations.view'));
  // …but still has every tenant permission:
  assert.ok(hasPermission(new Set([WILDCARD]), 'users.delete'));
  // The platform-admin role holds platform keys explicitly:
  const platform = new Set(SYSTEM_ROLE_PERMISSIONS[PLATFORM_ADMIN_ROLE_NAME]);
  assert.ok(hasPermission(platform, 'organizations.manage'));
  assert.ok(hasPermission(platform, 'users.view'));
  // No tenant role default ever includes a platform key:
  for (const role of ['manager', 'supervisor', 'operator'] as const) {
    for (const p of SYSTEM_ROLE_PERMISSIONS[role]) {
      assert.ok(!isPlatformPermission(p), `${role} leaked platform perm ${p}`);
    }
  }
  // Tenant + platform keys partition the catalog:
  assert.equal(TENANT_PERMISSION_KEYS.length + PLATFORM_PERMISSION_KEYS.length, ALL_PERMISSION_KEYS.length);
});

ok('isValidGrant accepts catalog keys + wildcards, rejects junk', () => {
  assert.ok(isValidGrant(WILDCARD));
  assert.ok(isValidGrant('projects.*'));
  assert.ok(isValidGrant('projects.view'));
  assert.ok(!isValidGrant('projects.fly'));
  assert.ok(!isValidGrant('nonexistent.*'));
  assert.ok(!isValidGrant(''));
});

ok('expandGrants expands wildcards to concrete TENANT keys (platform never leaks)', () => {
  assert.deepEqual(expandGrants([WILDCARD]).sort(), [...TENANT_PERMISSION_KEYS].sort());
  assert.ok(!expandGrants([WILDCARD]).some(isPlatformPermission));
  const wo = PERMISSION_CATALOG.find((f) => f.key === 'work-orders')!;
  assert.equal(expandGrants(['work-orders.*']).length, wo.actions.length);
  assert.deepEqual(expandGrants(['users.view', 'users.view', 'bogus.key']), ['users.view']);
});

ok('sanitizeGrants drops unknown keys and dedupes', () => {
  assert.deepEqual(sanitizeGrants(['users.view', 'users.view', 'nope.nope']), ['users.view']);
});

ok('catalog covers every permission referenced by controllers (no orphans)', () => {
  // Keys the backend decorators rely on — fails loudly if someone renames
  // a catalog entry without updating the controllers (checked again by grep
  // in CI/manual verification, this is the fast in-code safety net).
  const used = [
    'organizations.view', 'organizations.manage',
    'stations.view', 'stations.manage', 'stations.delete',
    'materials.view', 'materials.transact', 'materials.manage', 'materials.delete',
    'processes.view', 'processes.create', 'processes.update', 'processes.delete',
    'scheduling.view', 'costing.view', 'audit.view',
    'quality-analysis.view', 'quality-analysis.inspect', 'quality-analysis.delete',
    'templates.view', 'templates.manage',
    'coordination.view', 'coordination.manage', 'coordination.convert', 'coordination.delete',
    'shipping.view', 'shipping.manage', 'shipping.delete',
    'ncr.view', 'ncr.create', 'ncr.manage',
    'workforce.view', 'workforce.assign', 'workforce.manage',
    'traceability.view', 'traceability.record',
    'quality-reports.view', 'quality-reports.create', 'quality-reports.update', 'quality-reports.delete',
    'work-orders.view', 'work-orders.create', 'work-orders.update', 'work-orders.bulk-update', 'work-orders.execute',
    'production-orders.view', 'production-orders.create', 'production-orders.update', 'production-orders.delete', 'production-orders.execute',
    'projects.view', 'projects.create', 'projects.update', 'projects.delete', 'projects.import',
    'time-tracking.view', 'time-tracking.track', 'time-tracking.manage',
    'equipment.view', 'equipment.operate', 'equipment.report-downtime', 'equipment.maintain', 'equipment.manage', 'equipment.delete',
    'dashboard.view', 'dashboard.analytics', 'dashboard.export',
    'users.view', 'users.create', 'users.update', 'users.delete',
    'roles.view', 'roles.create', 'roles.update', 'roles.delete',
  ];
  for (const key of used) assert.ok(isKnownPermission(key), `controller uses unknown permission: ${key}`);
});

console.log(`${passed} assertions groups passed`);
