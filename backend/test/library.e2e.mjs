/**
 * Shared-library end-to-end suite — platform org bootstrap, default content,
 * publish (idempotent), auto-seed on tenant creation, and platform/tenant
 * isolation. Run against a freshly seeded backend.
 *
 *   API_URL=http://host:3000/api node test/library.e2e.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'changeme-dev-only';

let passed = 0, failed = 0;
const fails = [];
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
  const admin = await login('admin@pcs.com'); // default-tenant admin

  // ── 1. Library is provisioned with defaults ───────────────────────────────
  let r = await req('GET', '/library/summary', { token: platform.accessToken });
  check('platform sees library summary', r.status === 200 && r.data?.organization?.slug === 'platform', r.raw);
  check('library seeded with default processes', r.data?.processes >= 1, r.data);
  check('library seeded with default templates', r.data?.templates >= 2, r.data);

  r = await req('GET', '/library/processes', { token: platform.accessToken });
  const libProcs = r.data ?? [];
  const stdProc = libProcs.find((p) => p.name === 'Standard Fabrication');
  check('Standard Fabrication library process with 5 stages', stdProc?.stages?.length === 5, stdProc?.stages?.length);
  check('library QC stage is a hold point', stdProc?.stages?.some((s) => s.requiresInspection), stdProc?.stages?.map((s) => s.requiresInspection));

  r = await req('GET', '/library/templates', { token: platform.accessToken });
  const libTemplates = r.data ?? [];
  const ncrTemplate = libTemplates.find((t) => t.type === 'ncr');
  check('library has an NCR template', !!ncrTemplate, libTemplates.map((t) => t.type));

  // ── 2. Tenant admins CANNOT touch the library (platform-scoped) ───────────
  r = await req('GET', '/library/summary', { token: admin.accessToken });
  check('tenant admin DENIED library summary (403)', r.status === 403, r.status);
  r = await req('POST', `/library/processes/${stdProc.id}/publish`, { token: admin.accessToken, body: { allTenants: true } });
  check('tenant admin DENIED publish (403)', r.status === 403, r.status);

  // ── 3. New tenant is auto-seeded with library content ─────────────────────
  const slug = 'lib-tenant-' + Date.now();
  r = await req('POST', '/organizations', {
    token: platform.accessToken,
    body: {
      name: 'Library Tenant', slug,
      initialAdmin: { email: `${slug}@x.io`, password: 'tenant-pass-1', firstName: 'Tess', lastName: 'Tenant', employeeId: slug.toUpperCase() },
    },
  });
  check('provision tenant (auto-seeds library)', (r.status === 201 || r.status === 200) && !!r.data?.id, r.raw);
  const newOrgId = r.data?.id;

  const tenant = await login(`${slug}@x.io`, 'tenant-pass-1');
  r = await req('GET', '/processes', { token: tenant.accessToken });
  const tProcs = (r.data?.data ?? r.data ?? []);
  const seededProc = (Array.isArray(tProcs) ? tProcs : []).find((p) => p.name === 'Standard Fabrication');
  check('new tenant has Standard Fabrication seeded from library', !!seededProc, Array.isArray(tProcs) ? tProcs.map((p) => p.name) : tProcs);
  check('seeded process carries 5 stages', (seededProc?.stages?.length ?? 0) === 5, seededProc?.stages?.length);
  r = await req('GET', '/templates', { token: tenant.accessToken });
  const tTemplates = (r.data?.data ?? r.data ?? []);
  check('new tenant has seeded templates (incl. NCR)', Array.isArray(tTemplates) && tTemplates.some((t) => t.type === 'ncr'), Array.isArray(tTemplates) ? tTemplates.map((t) => t.type) : tTemplates);

  // ── 4. Explicit publish to one tenant is idempotent ───────────────────────
  r = await req('POST', `/library/processes/${stdProc.id}/publish`, { token: platform.accessToken, body: { organizationId: newOrgId } });
  check('re-publish process to seeded tenant succeeds', r.status === 200 || r.status === 201, r.raw);
  check('re-publish is idempotent (not created again)', r.data?.created === false, r.data);

  r = await req('GET', '/processes', { token: tenant.accessToken });
  const afterProcs = (r.data?.data ?? r.data ?? []);
  const stdCount = (Array.isArray(afterProcs) ? afterProcs : []).filter((p) => p.name === 'Standard Fabrication').length;
  check('no duplicate process after re-publish', stdCount === 1, stdCount);

  // ── 5. Publish to all tenants ─────────────────────────────────────────────
  r = await req('POST', `/library/templates/${ncrTemplate.id}/publish`, { token: platform.accessToken, body: { allTenants: true } });
  check('publish template to all tenants returns per-org results', r.status === 200 || r.status === 201 ? Array.isArray(r.data) && r.data.length >= 1 : false, r.raw);
  check('all-tenants publish never targets the platform org', Array.isArray(r.data) && r.data.every((x) => x.organizationId !== r.data?.platformId), true);

  // ── 6. Platform org is hidden from the tenant provisioning list ───────────
  r = await req('GET', '/organizations', { token: platform.accessToken });
  const orgList = r.data ?? [];
  check('GET /organizations excludes the platform library org', Array.isArray(orgList) && !orgList.some((o) => o.slug === 'platform'), orgList.map?.((o) => o.slug));
  check('GET /organizations includes real tenants', orgList.some((o) => o.slug === slug), orgList.map?.((o) => o.slug));

  // ── 7. Publishing into the platform org itself is rejected ────────────────
  const plat = await req('GET', '/library/summary', { token: platform.accessToken });
  const platformOrgId = plat.data?.organization?.id;
  r = await req('POST', `/library/processes/${stdProc.id}/publish`, { token: platform.accessToken, body: { organizationId: platformOrgId } });
  check('cannot publish into the platform org itself (400)', r.status === 400, r.status);

  console.log(`\n==== RESULT: ${passed} passed, ${failed} failed${fails.length ? ' → ' + fails.join(' | ') : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
