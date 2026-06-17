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
// Multipart upload helper (lets fetch set the boundary header itself).
async function reqForm(method, path, { token, fields = {}, file } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file) form.append('file', new Blob([file.buf], { type: file.type }), file.name);
  const res = await fetch(API + path, {
    method, body: form,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, data: json?.data ?? json, raw: json };
}
// 1x1 transparent PNG.
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

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

  // ── 9. Agents + assignment guard + optimistic concurrency ─────────────────
  r = await req('POST', '/support/tickets', { token: operator.accessToken, body: {
    subject: 'Second issue', description: 'Another problem to triage.', category: 'question',
  } });
  const t2 = r.data?.id;

  r = await req('GET', '/support-desk/agents', { token: platform.accessToken });
  check('desk agents list includes platform staff', (r.data ?? []).some((a) => a.id === platform.user.id), r.data);

  r = await req('PATCH', `/support-desk/tickets/${t2}`, { token: platform.accessToken, body: { assignedToUserId: operator.user.id } });
  check('cannot assign a ticket to a tenant user (400)', r.status === 400, r.status);
  r = await req('PATCH', `/support-desk/tickets/${t2}`, { token: platform.accessToken, body: { assignedToUserId: platform.user.id } });
  check('can assign to a real support agent', r.data?.assignedToUserId === platform.user.id, r.data?.assignedToName);

  r = await req('GET', `/support-desk/tickets/${t2}`, { token: platform.accessToken });
  const v0 = r.data?.version;
  check('detail exposes a version for optimistic concurrency', typeof v0 === 'number', v0);
  r = await req('PATCH', `/support-desk/tickets/${t2}`, { token: platform.accessToken, body: { priority: 'high', expectedVersion: v0 } });
  check('triage with current version succeeds', r.data?.priority === 'high', r.data?.priority);
  r = await req('PATCH', `/support-desk/tickets/${t2}`, { token: platform.accessToken, body: { priority: 'urgent', expectedVersion: v0 } });
  check('stale version triage rejected (409)', r.status === 409, r.status);

  // ── 10. Attachments (customer public + support internal) ──────────────────
  r = await reqForm('POST', `/support/tickets/${t2}/attachments`, {
    token: operator.accessToken, fields: { body: 'Screenshot of the error' }, file: { buf: PNG_1PX, type: 'image/png', name: 'shot.png' },
  });
  const custAttachMsg = (r.data?.messages ?? []).find((m) => m.attachmentCount > 0 && m.authorKind === 'customer');
  check('customer can reply with an image attachment', (r.status === 201 || r.status === 200) && !!custAttachMsg, r.raw?.message ?? r.status);
  if (custAttachMsg) {
    const res = await fetch(`${API}/support/tickets/${t2}/messages/${custAttachMsg.id}/attachments/0`, { headers: { Authorization: `Bearer ${operator.accessToken}` } });
    check('customer can download their attachment (image/*)', res.status === 200 && (res.headers.get('content-type') || '').startsWith('image/'), res.status);
  }
  // Reject a non-image / non-pdf upload.
  r = await reqForm('POST', `/support/tickets/${t2}/attachments`, {
    token: operator.accessToken, file: { buf: Buffer.from('hello'), type: 'text/plain', name: 'note.txt' },
  });
  check('non image/pdf attachment rejected (400)', r.status === 400, r.status);

  // Support internal attachment must stay hidden from the customer.
  r = await reqForm('POST', `/support-desk/tickets/${t2}/attachments`, {
    token: platform.accessToken, fields: { body: 'infra log', internal: 'true' }, file: { buf: PNG_1PX, type: 'image/png', name: 'log.png' },
  });
  const internalAttachMsg = (r.data?.messages ?? []).find((m) => m.internal && m.attachmentCount > 0);
  check('support can attach an internal-note file (desk sees it)', !!internalAttachMsg, r.raw?.message ?? r.status);
  if (internalAttachMsg) {
    let res = await fetch(`${API}/support/tickets/${t2}/messages/${internalAttachMsg.id}/attachments/0`, { headers: { Authorization: `Bearer ${operator.accessToken}` } });
    check('customer CANNOT download an internal-note attachment (404)', res.status === 404, res.status);
    res = await fetch(`${API}/support-desk/tickets/${t2}/messages/${internalAttachMsg.id}/attachments/0`, { headers: { Authorization: `Bearer ${platform.accessToken}` } });
    check('desk CAN download the internal-note attachment', res.status === 200, res.status);
  }

  console.log(`\n==== RESULT: ${passed} passed, ${failed} failed${fails.length ? ' → ' + fails.join(' | ') : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
