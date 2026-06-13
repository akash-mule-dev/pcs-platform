/**
 * Customer support e2e — customer raises/replies, platform triages, internal
 * notes stay hidden, tenant isolation, status workflow. Fresh seeded backend.
 *   API_URL=http://host:3000/api node test/support.e2e.mjs
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
  const admin = await login('admin@pcs.com');       // default tenant admin
  const operator = await login('operator1@pcs.com'); // same tenant, operator

  // ── 1. Customer raises a ticket ───────────────────────────────────────────
  let r = await req('GET', '/support/meta', { token: operator.accessToken });
  check('meta lists statuses/priorities/categories', r.data?.statuses?.length === 5 && r.data?.categories?.length >= 4, r.data && Object.keys(r.data));

  r = await req('POST', '/support/tickets', { token: operator.accessToken, body: {
    subject: '3D viewer not loading', description: 'The model viewer is blank on the project page.',
    category: 'bug', priority: 'high', contextUrl: '/projects/123',
  } });
  check('operator raises a ticket', (r.status === 201 || r.status === 200) && /^TKT-\d{4}-\d{4}$/.test(r.data?.number || ''), r.raw);
  const ticketId = r.data?.id;
  const ticketNo = r.data?.number;
  check('new ticket is open + snapshots raiser', r.data?.status === 'open' && !!r.data?.raisedByName, r.data);

  // Same-org admin sees it (company-wide visibility)
  r = await req('GET', '/support/tickets', { token: admin.accessToken });
  check('same-org admin sees the company ticket', (r.data ?? []).some((t) => t.id === ticketId), (r.data ?? []).map((t) => t.number));

  // ── 2. Platform desk sees it cross-tenant ─────────────────────────────────
  r = await req('GET', '/support-desk/tickets', { token: platform.accessToken });
  const deskRow = (r.data ?? []).find((t) => t.id === ticketId);
  check('platform desk lists the ticket with org name', !!deskRow && !!deskRow.organizationName, deskRow);
  r = await req('GET', '/support-desk/stats', { token: platform.accessToken });
  check('desk stats include counts', typeof r.data?.total === 'number' && r.data.total >= 1, r.data);

  // Tenant admin cannot reach the platform desk
  r = await req('GET', '/support-desk/tickets', { token: admin.accessToken });
  check('tenant admin DENIED support desk (403)', r.status === 403, r.status);

  // ── 3. Platform assigns + replies; status auto-advances ───────────────────
  r = await req('PATCH', `/support-desk/tickets/${ticketId}`, { token: platform.accessToken, body: { assignedToUserId: 'me' } });
  check('platform self-assigns', r.data?.assignedToUserId === platform.user.id && !!r.data?.assignedToName, r.data?.assignedToName);

  r = await req('POST', `/support-desk/tickets/${ticketId}/messages`, { token: platform.accessToken, body: { body: 'Thanks — can you share your browser + console errors?' } });
  check('support public reply moves open → in_progress', r.data?.status === 'in_progress', r.data?.status);
  check('support reply appears in thread', (r.data?.messages ?? []).some((m) => m.authorKind === 'support' && !m.internal), r.data?.messages?.map((m) => m.authorKind));

  // Internal note
  r = await req('POST', `/support-desk/tickets/${ticketId}/messages`, { token: platform.accessToken, body: { body: 'Likely the GLB CDN timeout — check infra.', internal: true } });
  check('internal note added (desk sees it)', (r.data?.messages ?? []).some((m) => m.internal), true);

  // ── 4. Internal note is HIDDEN from the customer ──────────────────────────
  r = await req('GET', `/support/tickets/${ticketId}`, { token: operator.accessToken });
  const custMsgs = r.data?.messages ?? [];
  check('customer sees the public support reply', custMsgs.some((m) => m.authorKind === 'support'), custMsgs.map((m) => m.authorKind));
  check('customer does NOT see internal notes', custMsgs.every((m) => m.internal === false), custMsgs.map((m) => m.internal));

  // ── 5. Support sets pending; customer reply reopens ───────────────────────
  r = await req('PATCH', `/support-desk/tickets/${ticketId}`, { token: platform.accessToken, body: { status: 'pending' } });
  check('support sets pending (awaiting customer)', r.data?.status === 'pending', r.data?.status);
  r = await req('POST', `/support/tickets/${ticketId}/messages`, { token: operator.accessToken, body: { body: 'Console shows a 504 on the .glb request.' } });
  check('customer reply reopens pending → open', r.data?.status === 'open', r.data?.status);

  // ── 6. Resolve, then customer reopens by replying ─────────────────────────
  r = await req('PATCH', `/support-desk/tickets/${ticketId}`, { token: platform.accessToken, body: { status: 'resolved' } });
  check('support resolves', r.data?.status === 'resolved', r.data?.status);
  r = await req('POST', `/support/tickets/${ticketId}/messages`, { token: operator.accessToken, body: { body: 'Still happening intermittently.' } });
  check('customer reply reopens resolved → open', r.data?.status === 'open', r.data?.status);

  // Invalid transition guard (closed → pending not allowed)
  r = await req('PATCH', `/support-desk/tickets/${ticketId}`, { token: platform.accessToken, body: { status: 'closed' } });
  check('support closes', r.data?.status === 'closed', r.data?.status);
  r = await req('PATCH', `/support-desk/tickets/${ticketId}`, { token: platform.accessToken, body: { status: 'pending' } });
  check('invalid transition closed → pending rejected (400)', r.status === 400, r.status);

  // ── 7. Tenant isolation ───────────────────────────────────────────────────
  const slug = 'sup-tenant-' + Date.now();
  r = await req('POST', '/organizations', { token: platform.accessToken, body: {
    name: 'Support Tenant', slug,
    initialAdmin: { email: `${slug}@x.io`, password: 'pass-1234', firstName: 'Sue', lastName: 'Port', employeeId: slug.toUpperCase() },
  } });
  const otherAdmin = await login(`${slug}@x.io`, 'pass-1234');
  r = await req('GET', '/support/tickets', { token: otherAdmin.accessToken });
  check('other tenant does NOT see the first tenant ticket', !(r.data ?? []).some((t) => t.id === ticketId), (r.data ?? []).map((t) => t.number));
  r = await req('GET', `/support/tickets/${ticketId}`, { token: otherAdmin.accessToken });
  check('other tenant cannot fetch the ticket by id (404)', r.status === 404, r.status);

  // ── 8. Audit ──────────────────────────────────────────────────────────────
  r = await req('GET', '/audit?entityType=support_ticket&limit=50', { token: platform.accessToken });
  const actions = (r.data ?? []).map((x) => x.action);
  check('support actions audited (create + reply + update)', ['create', 'reply', 'update'].every((a) => actions.includes(a)), actions);

  console.log(`\n==== RESULT: ${passed} passed, ${failed} failed${fails.length ? ' → ' + fails.join(' | ') : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
