/**
 * Support impersonation + company self-service e2e. Fresh seeded backend.
 *   API_URL=http://host:3000/api node test/support-company.e2e.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'changeme-dev-only';

let passed = 0, failed = 0; const fails = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; fails.push(name); console.log(`  FAIL ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra)?.slice(0, 220) : ''}`); }
}
async function req(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, data: json?.data ?? json, raw: json };
}
async function login(email, password = SEED_PASSWORD) {
  const r = await req('POST', '/auth/login', { body: { email, password } });
  if (!r.data?.accessToken) throw new Error(`login failed for ${email}: ${JSON.stringify(r.raw)}`);
  return r.data;
}

(async () => {
  const platform = await login('platform@pcs.com');
  const admin = await login('admin@pcs.com'); // default tenant admin

  // ── Company self-service (tenant-facing) ──────────────────────────────────
  let r = await req('GET', '/company', { token: admin.accessToken });
  check('tenant admin reads own company', r.status === 200 && !!r.data?.id, r.raw);
  check('company view exposes slug + profile object', !!r.data?.slug && typeof r.data?.profile === 'object', r.data);
  const ownOrgId = r.data?.id;

  r = await req('PATCH', '/company', { token: admin.accessToken, body: {
    name: 'Default Org (Renamed)', description: 'Steel fabrication shop',
    profile: { contactEmail: 'ops@default.example', phone: '+1-555-0100', city: 'Pune', country: 'India' },
  } });
  check('tenant admin edits own company', r.status === 200 && r.data?.name === 'Default Org (Renamed)', r.raw);
  check('profile persisted', r.data?.profile?.contactEmail === 'ops@default.example' && r.data?.profile?.city === 'Pune', r.data?.profile);

  r = await req('GET', '/company', { token: admin.accessToken });
  check('company edits round-trip', r.data?.profile?.phone === '+1-555-0100', r.data?.profile);

  // Operator (no company.manage by default) can view but not edit
  const op = await login('operator1@pcs.com');
  r = await req('GET', '/auth/permissions', { token: op.accessToken });
  const opPerms = r.data?.permissions ?? [];
  check('operator lacks company.manage', !opPerms.includes('company.manage'), opPerms.filter((p) => p.startsWith('company.')));
  r = await req('PATCH', '/company', { token: op.accessToken, body: { name: 'hax' } });
  check('operator DENIED company edit (403)', r.status === 403, r.status);

  // Platform operator is org-less → /company has no tenant context
  r = await req('GET', '/company', { token: platform.accessToken });
  check('platform operator has no own-company (403/500-guarded, not a tenant)', r.status === 403 || r.status === 400 || r.status === 500, r.status);

  // ── Impersonation ─────────────────────────────────────────────────────────
  r = await req('POST', `/organizations/${ownOrgId}/impersonate`, { token: admin.accessToken });
  check('tenant admin CANNOT impersonate (403)', r.status === 403, r.status);

  r = await req('POST', `/organizations/${ownOrgId}/impersonate`, { token: platform.accessToken });
  check('platform operator starts a support session', (r.status === 200 || r.status === 201) && !!r.data?.accessToken, r.raw);
  check('impersonation response is flagged + scoped to the tenant', r.data?.impersonation === true && r.data?.organization?.id === ownOrgId, r.data?.organization);
  const supportToken = r.data?.accessToken;

  // Acting inside the tenant with the support token
  r = await req('GET', '/auth/permissions', { token: supportToken });
  check('support session resolves as tenant admin (wildcard-expanded, no platform keys)',
    r.data?.role?.name === 'admin' && r.data?.permissions?.includes('work-orders.view') && !r.data?.permissions?.some((p) => p.startsWith('organizations.')),
    { role: r.data?.role?.name });
  r = await req('GET', '/users', { token: supportToken });
  check('support session can see the tenant users (the issue surface)', r.status === 200, r.status);
  r = await req('GET', '/company', { token: supportToken });
  check('support session sees the impersonated company', r.status === 200 && r.data?.id === ownOrgId, r.data?.id);

  // Support session is still platform-blocked from cross-tenant management
  r = await req('GET', '/organizations', { token: supportToken });
  check('support session CANNOT manage organizations (403)', r.status === 403, r.status);

  // Cannot impersonate the platform org itself
  const plat = await req('GET', '/library/summary', { token: platform.accessToken });
  const platformOrgId = plat.data?.organization?.id;
  r = await req('POST', `/organizations/${platformOrgId}/impersonate`, { token: platform.accessToken });
  check('cannot impersonate the platform org (400)', r.status === 400, r.status);

  // ── Audit trail ─────────────────────────────────────────────────────────
  r = await req('GET', '/audit?entityType=organization&limit=50', { token: platform.accessToken });
  check('impersonation is audit-logged', (r.data ?? []).some((x) => x.action === 'impersonate'), (r.data ?? []).map?.((x) => x.action));
  r = await req('GET', '/audit?entityType=company&limit=50', { token: admin.accessToken });
  check('company edit is audit-logged', (r.data ?? []).some((x) => x.action === 'update'), r.status);

  console.log(`\n==== RESULT: ${passed} passed, ${failed} failed${fails.length ? ' → ' + fails.join(' | ') : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
