/**
 * RBAC end-to-end regression suite — fine-grained permissions, custom roles,
 * platform/tenant separation, safety rails and audit logging.
 *
 * Run against a FRESHLY SEEDED backend (drops nothing, but expects the seed
 * users to exist and "Eterio Steel"/"Second Steel" orgs to NOT exist yet):
 *
 *   # terminal 1 — any Postgres, e.g. docker compose up -d postgres
 *   DATABASE_URL=postgresql://... node dist/main.js --seed
 *   # terminal 2
 *   npm run test:rbac:e2e          # or: API_URL=http://host:3000/api node test/rbac-roles.e2e.mjs
 *
 * Env: API_URL (default http://localhost:3000/api), SEED_PASSWORD (default changeme-dev-only)
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'changeme-dev-only';

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    fails.push(name);
    console.log(`  FAIL ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra)?.slice(0, 220) : ''}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  // The API wraps responses in { data: ... }
  return { status: res.status, data: json?.data ?? json, raw: json };
}

async function login(email, password = SEED_PASSWORD) {
  const r = await req('POST', '/auth/login', { body: { email, password } });
  if (!r.data?.accessToken) throw new Error(`login failed for ${email}: ${JSON.stringify(r.raw)}`);
  return r.data;
}

const QC_PERMS = [
  'dashboard.view', 'work-orders.view', 'time-tracking.view', 'time-tracking.track',
  'quality-reports.view', 'quality-reports.create', 'quality-reports.update', 'ncr.view', 'ncr.create',
];

(async () => {
  // ── 1. Seeded tenant admin: org-stamped, wildcard, but NOT platform ───────
  const admin = await login('admin@pcs.com');
  check('seeded admin login, role isSystem', admin.user?.role?.isSystem === true, admin.user?.role);
  check('seeded admin belongs to the default org (single-boot fresh DB)', !!admin.user?.organizationId, admin.user?.organizationId);

  let r = await req('GET', '/auth/permissions', { token: admin.accessToken });
  check('tenant admin permissions = [*]', r.data?.permissions?.includes('*'), r.data);
  r = await req('GET', '/organizations', { token: admin.accessToken });
  check('tenant admin DENIED listing organizations (403)', r.status === 403, r.status);
  r = await req('POST', '/organizations', { token: admin.accessToken, body: { name: 'Nope Inc', slug: 'nope-inc' } });
  check('tenant admin DENIED provisioning organizations (403)', r.status === 403, r.status);

  // ── 2. Platform operator: org-less, holds platform permissions ────────────
  const platform = await login('platform@pcs.com');
  check('platform admin login, org-less by design', platform.user?.organizationId === null, platform.user?.organizationId);
  r = await req('GET', '/auth/permissions', { token: platform.accessToken });
  check('platform admin holds organizations.manage', r.data?.permissions?.includes('organizations.manage'), r.data?.permissions);
  r = await req('GET', '/organizations', { token: platform.accessToken });
  check('platform admin lists organizations (sees default org)', r.status === 200 && r.data?.some?.((o) => o.slug === 'default'), r.status);
  const platformRolesList = await req('GET', '/rbac/roles', { token: platform.accessToken });
  const platformAdminRole = platformRolesList.data?.find?.((x) => x.name === 'platform-admin');
  check('platform session sees the platform-admin role', !!platformAdminRole);

  // ── 3. Provision a tenant WITH its first admin (org bootstrap) ────────────
  r = await req('POST', '/organizations', {
    token: platform.accessToken,
    body: {
      name: 'Eterio Steel', slug: 'eterio-steel',
      initialAdmin: { email: 'owner@eterio.ca', password: 'owner-pass-1', firstName: 'Shweta', lastName: 'Baravkar', employeeId: 'ETR-001' },
    },
  });
  check('org provisioned with bootstrap admin', (r.status === 201 || r.status === 200) && !!r.data?.initialAdmin?.id, r.raw);
  const org1 = r.data;

  const owner = await login('owner@eterio.ca', 'owner-pass-1');
  check('bootstrap admin can sign in, stamped with new org', owner.user?.organizationId === org1.id, owner.user?.organizationId);
  r = await req('GET', '/auth/permissions', { token: owner.accessToken });
  check('bootstrap admin holds tenant wildcard', r.data?.permissions?.includes('*'));

  // ── 4. Roles & catalog inside the tenant ───────────────────────────────────
  r = await req('GET', '/rbac/catalog', { token: owner.accessToken });
  check('catalog served (features + categories)', r.status === 200 && r.data?.features?.length > 20, r.data?.features?.length);
  const catalogKeys = (r.data?.features ?? []).flatMap((f) => f.actions.map((a) => `${f.key}.${a.action}`));

  r = await req('GET', '/rbac/roles', { token: owner.accessToken });
  const tenantVisible = (r.data ?? []).map((x) => x.name);
  check('tenant sees 4 system roles', r.data?.filter?.((x) => x.isSystem).length === 4, tenantVisible);
  check('platform-admin role is INVISIBLE in tenant sessions', !tenantVisible.includes('platform-admin'), tenantVisible);
  const managerRole = r.data.find((x) => x.name === 'manager');
  const adminRole = r.data.find((x) => x.name === 'admin');
  check('manager role carries fine-grained defaults', managerRole?.permissions?.includes('work-orders.bulk-update'));

  // ── 5. Custom role lifecycle ───────────────────────────────────────────────
  r = await req('POST', '/rbac/roles', { token: owner.accessToken, body: { name: 'QC Inspector', description: 'Records inspections and raises NCRs', permissions: QC_PERMS } });
  check('create custom role', (r.status === 201 || r.status === 200) && r.data?.isSystem === false, r.raw);
  const qcRole = r.data;
  check('custom role echoes exact permission set', JSON.stringify([...(qcRole?.permissions ?? [])].sort()) === JSON.stringify([...QC_PERMS].sort()));

  r = await req('POST', '/rbac/roles', { token: owner.accessToken, body: { name: 'qc inspector', permissions: ['dashboard.view'] } });
  check('duplicate role name rejected, case-insensitive (409)', r.status === 409, r.status);
  r = await req('POST', '/rbac/roles', { token: owner.accessToken, body: { name: 'Bad Role', permissions: ['foo.bar'] } });
  check('unknown permission rejected (400)', r.status === 400, r.status);
  r = await req('POST', '/rbac/roles', { token: owner.accessToken, body: { name: 'Bad Role 2', permissions: ['*'] } });
  check('wildcard rejected for custom roles (400)', r.status === 400, r.status);
  r = await req('POST', '/rbac/roles', { token: owner.accessToken, body: { name: 'Sneaky Platform', permissions: ['organizations.manage'] } });
  check('platform permission rejected for custom roles (400)', r.status === 400, r.status);
  r = await req('PATCH', `/rbac/roles/${managerRole.id}`, { token: owner.accessToken, body: { description: 'nope' } });
  check('system role immutable (PATCH 403)', r.status === 403, r.status);
  r = await req('DELETE', `/rbac/roles/${managerRole.id}`, { token: owner.accessToken });
  check('system role undeletable (DELETE 403)', r.status === 403, r.status);

  // ── 6. Assign the custom role; verify allow/deny enforcement ──────────────
  r = await req('POST', '/users', {
    token: owner.accessToken,
    body: { employeeId: 'ETR-100', email: 'qc@eterio.ca', mobileNo: '9876500100', password: 'qc-pass-123', firstName: 'Quinn', lastName: 'Inspector', roleId: qcRole.id },
  });
  check('create user with custom role', r.status === 201 || r.status === 200, r.raw);
  const qcUserId = r.data?.id;
  check('new user stamped with the tenant org', r.data?.organizationId === org1.id);

  const qc = await login('qc@eterio.ca', 'qc-pass-123');
  r = await req('GET', '/auth/permissions', { token: qc.accessToken });
  check('custom-role user gets exact permission set', JSON.stringify([...(r.data?.permissions ?? [])].sort()) === JSON.stringify([...QC_PERMS].sort()), r.data?.permissions);
  check('permissions endpoint names the custom role', r.data?.role?.name === 'QC Inspector');

  r = await req('GET', '/quality-reports', { token: qc.accessToken });
  check('ALLOW quality-reports.view', r.status === 200, r.status);
  r = await req('GET', '/work-orders', { token: qc.accessToken });
  check('ALLOW work-orders.view', r.status === 200, r.status);
  r = await req('GET', '/users', { token: qc.accessToken });
  check('DENY users.view (403)', r.status === 403, r.status);
  check('403 names the missing permission', JSON.stringify(r.raw)?.includes('users.view'), r.raw);
  r = await req('GET', '/processes', { token: qc.accessToken });
  check('DENY processes.view (403)', r.status === 403, r.status);
  r = await req('POST', '/rbac/roles', { token: qc.accessToken, body: { name: 'X', permissions: ['dashboard.view'] } });
  check('DENY roles.create (403)', r.status === 403, r.status);
  r = await req('POST', '/work-orders', { token: qc.accessToken, body: {} });
  check('DENY work-orders.create (403)', r.status === 403, r.status);

  // ── 7. Live permission edits propagate (cache invalidation) ───────────────
  const reduced = QC_PERMS.filter((p) => p !== 'quality-reports.create');
  r = await req('PATCH', `/rbac/roles/${qcRole.id}`, { token: owner.accessToken, body: { permissions: reduced } });
  check('edit custom role permissions', r.status === 200, r.status);
  r = await req('GET', '/auth/permissions', { token: qc.accessToken });
  check('revocation is immediate (no stale cache)', !(r.data?.permissions ?? []).includes('quality-reports.create'), r.data?.permissions);
  r = await req('POST', '/quality-reports', { token: qc.accessToken, body: { templateId: '00000000-0000-0000-0000-000000000000', productionOrderId: '00000000-0000-0000-0000-000000000000' } });
  check('revoked action now denied (403)', r.status === 403, r.status);

  // ── 8. Safety rails ────────────────────────────────────────────────────────
  r = await req('DELETE', `/rbac/roles/${qcRole.id}`, { token: owner.accessToken });
  check('role with assigned users undeletable (409)', r.status === 409, r.status);
  r = await req('PATCH', `/users/${owner.user.id}`, { token: owner.accessToken, body: { roleId: qcRole.id } });
  check('cannot change own role (403)', r.status === 403, r.status);
  r = await req('PATCH', `/users/${owner.user.id}`, { token: owner.accessToken, body: { isActive: false } });
  check('cannot deactivate self (403)', r.status === 403, r.status);
  r = await req('DELETE', `/users/${owner.user.id}`, { token: owner.accessToken });
  check('cannot delete self (403)', r.status === 403, r.status);
  r = await req('PATCH', `/users/${qcUserId}`, { token: owner.accessToken, body: { roleId: platformAdminRole.id } });
  check('tenant admin CANNOT grant platform-admin (403, no escalation)', r.status === 403, r.status);

  // ── 9. Platform accounts are invisible inside tenants ─────────────────────
  r = await req('GET', '/users?limit=100', { token: owner.accessToken });
  const tenantUserEmails = (r.data ?? []).map((u) => u.email);
  check('platform operator absent from tenant user list', !tenantUserEmails.includes('platform@pcs.com'), tenantUserEmails);
  r = await req('GET', `/users/${platform.user.id}`, { token: owner.accessToken });
  check('platform operator not fetchable by id from tenant (404)', r.status === 404, r.status);
  r = await req('PATCH', `/users/${platform.user.id}`, { token: owner.accessToken, body: { firstName: 'Hax' } });
  check('platform operator not mutable from tenant (404)', r.status === 404, r.status);

  // ── 10. Duplicate system role → editable custom role (no platform leak) ───
  r = await req('POST', `/rbac/roles/${adminRole.id}/duplicate`, { token: owner.accessToken, body: { name: 'Deputy Admin' } });
  check('duplicate admin role into custom role', (r.status === 201 || r.status === 200) && r.data?.isSystem === false, r.raw);
  const deputy = r.data;
  check('duplicated admin covers tenant keys but NO platform keys', deputy?.permissions?.includes('users.delete') && !deputy?.permissions?.some((p) => p.startsWith('organizations.')), deputy?.permissions?.filter((p) => p.startsWith('organizations.')));

  // ── 11. Reassign, then delete the now-unused role ──────────────────────────
  r = await req('PATCH', `/users/${qcUserId}`, { token: owner.accessToken, body: { roleId: deputy.id } });
  check('reassign user to duplicated role', r.status === 200, r.raw);
  r = await req('DELETE', `/rbac/roles/${qcRole.id}`, { token: owner.accessToken });
  check('unused custom role deletable', r.status === 200 || r.status === 204, r.status);

  // ── 12. Cross-tenant isolation ─────────────────────────────────────────────
  r = await req('POST', '/organizations', {
    token: platform.accessToken,
    body: {
      name: 'Second Steel', slug: 'second-steel',
      initialAdmin: { email: 'admin@second.steel', password: 'second-pass-1', firstName: 'Sam', lastName: 'Second', employeeId: 'SEC-001' },
    },
  });
  check('second tenant provisioned', r.status === 201 || r.status === 200, r.status);
  const admin2 = await login('admin@second.steel', 'second-pass-1');
  r = await req('GET', '/rbac/roles', { token: admin2.accessToken });
  const visible2 = (r.data ?? []).map((x) => x.name);
  check('tenant 2 sees system roles but NOT tenant 1 custom roles', visible2.includes('manager') && !visible2.includes('Deputy Admin'), visible2);
  r = await req('PATCH', `/users/${qcUserId}`, { token: admin2.accessToken, body: { firstName: 'Hax' } });
  check('tenant 2 cannot touch tenant 1 users (404)', r.status === 404, r.status);
  r = await req('POST', '/users', { token: admin2.accessToken, body: { employeeId: 'SEC-X', email: 'x@second.steel', mobileNo: '1', password: 'xxxxxx', firstName: 'X', lastName: 'X', roleId: deputy.id } });
  check('tenant 2 cannot assign tenant 1 custom role (400)', r.status === 400, r.status);

  // ── 13. Seeded operator behavior preserved ─────────────────────────────────
  const op = await login('operator1@pcs.com');
  r = await req('GET', '/auth/permissions', { token: op.accessToken });
  const opPerms = r.data?.permissions ?? [];
  check('operator: execute + track granted, create withheld', opPerms.includes('work-orders.execute') && opPerms.includes('time-tracking.track') && !opPerms.includes('work-orders.create'));
  check('operator perms all exist in catalog', opPerms.every((p) => catalogKeys.includes(p)), opPerms.filter((p) => !catalogKeys.includes(p)));
  r = await req('GET', '/work-orders', { token: op.accessToken });
  check('operator can view work orders', r.status === 200, r.status);
  r = await req('GET', '/users', { token: op.accessToken });
  check('operator denied users list (403)', r.status === 403, r.status);

  // Seeded admin can manage roles in the default org too (single-boot UX).
  r = await req('POST', '/rbac/roles', { token: admin.accessToken, body: { name: 'Default Org Role', permissions: ['dashboard.view'] } });
  check('seeded admin can create custom roles in the default org', r.status === 201 || r.status === 200, r.raw);

  // ── 14. Audit trail ────────────────────────────────────────────────────────
  r = await req('GET', '/audit?entityType=role&limit=50', { token: owner.accessToken });
  const roleAudits = r.data ?? [];
  check('audit: role create/update/delete recorded', ['create', 'update', 'delete'].every((a) => roleAudits.some((x) => x.action === a)), roleAudits.map?.((x) => x.action));
  r = await req('GET', '/audit?entityType=user&limit=50', { token: owner.accessToken });
  const userAudits = r.data ?? [];
  check('audit: user create + role_change recorded', userAudits.some((x) => x.action === 'create') && userAudits.some((x) => x.action === 'role_change'), userAudits.map?.((x) => x.action));
  r = await req('GET', '/audit?entityType=organization&limit=50', { token: platform.accessToken });
  check('audit: organization provisioning recorded', (r.data ?? []).some((x) => x.action === 'create'), r.status);

  console.log(`\n==== RESULT: ${passed} passed, ${failed} failed${fails.length ? ' → ' + fails.join(' | ') : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
