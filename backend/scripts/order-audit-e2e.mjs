/**
 * Work-order audit / bulk-update / history / ship-readiness E2E suite.
 *
 * Exercises the production-order endpoints end to end against a RUNNING API:
 * create project + assemblies → order → audit shape → bulk + single stage
 * updates → stage-change history (actor/source) → ship-readiness lifecycle →
 * NCR quality gate (pre-warn + enforcement) → status sync → cleanup.
 *
 * ⚠ Run against a SCRATCH database only — it writes fixtures via SQL
 * (assembly nodes) and mutates users' organization when missing.
 *
 *   E2E_PG_URL=postgresql://postgres@localhost:5433/pcs \
 *   API_URL=http://localhost:3000/api \
 *   npm run test:e2e:orders
 *
 * Env: API_URL (default http://localhost:3000/api), E2E_EMAIL, E2E_PASSWORD,
 *      E2E_PG_URL (required).
 */
import pg from 'pg';

const A = process.env.API_URL || 'http://localhost:3000/api';
const EMAIL = process.env.E2E_EMAIL || 'admin@pcs.com';
const PASSWORD = process.env.E2E_PASSWORD || 'changeme-dev-only';
const PG_URL = process.env.E2E_PG_URL;

if (!PG_URL) {
  console.error('E2E_PG_URL is required (scratch DB only — this suite writes fixtures via SQL).');
  process.exit(2);
}

/** Unwrap the API's global `{ data: ... }` response envelope. */
const j = async (r) => {
  const t = await r.text();
  let v;
  try { v = JSON.parse(t); } catch { throw new Error(`non-json ${r.status} ${t.slice(0, 200)}`); }
  return v && typeof v === 'object' && 'data' in v && !('statusCode' in v) ? v.data : v;
};

let n = 0;
const assert = (c, m) => {
  if (!c) { console.error('FAIL: ' + m); process.exit(1); }
  console.log(`ok ${++n} - ${m}`);
};

(async () => {
  const db = new pg.Client({ connectionString: PG_URL });
  await db.connect();

  // Fixture: ensure the login user belongs to an organization (fresh seeds don't).
  const org = await db.query(
    `INSERT INTO organizations (name, slug) VALUES ('E2E Org','e2e-org')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const orgId = org.rows[0].id;
  await db.query(`UPDATE users SET organization_id = $1 WHERE organization_id IS NULL`, [orgId]);

  let r = await fetch(`${A}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const login = await j(r);
  assert(!!login.accessToken, 'login');
  const H = { 'content-type': 'application/json', authorization: `Bearer ${login.accessToken}` };
  const userOrg = login.user?.organizationId;

  r = await fetch(`${A}/processes/standard`, { method: 'POST', headers: H, body: '{}' });
  const proc = await j(r);
  assert(!!proc.id, 'standard process');

  r = await fetch(`${A}/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: `Audit E2E ${Date.now()}` }) });
  const project = await j(r);
  assert(!!project.id, 'project created');

  const marks = ['B1001', 'B1002', 'B1003'];
  for (let i = 0; i < marks.length; i++) {
    await db.query(
      `INSERT INTO assembly_nodes (project_id, organization_id, node_type, name, mark, quantity, depth, sort_index, profile, material_grade, length_mm, weight_kg)
       VALUES ($1,$2,'assembly',$3,$3,1,0,$4,'W310x52','350W',6100,312.5)`,
      [project.id, userOrg ?? orgId, marks[i], i],
    );
  }

  r = await fetch(`${A}/projects/${project.id}/orders`, { method: 'POST', headers: H, body: JSON.stringify({ processId: proc.id, quantity: 2, customerName: 'Acme Steel' }) });
  const order = await j(r);
  assert(!!order.id && !!order.number, `order created ${order.number}`);

  // ── Audit shape ──
  r = await fetch(`${A}/orders/${order.id}/audit`, { headers: H });
  let audit = await j(r);
  assert(audit.order && audit.order.id === order.id, 'audit returns order');
  assert(audit.project && audit.project.id === project.id, 'audit returns project link');
  assert(audit.stages.length === 5, `audit has 5 stage columns (got ${audit.stages.length})`);
  assert(audit.items.length === 3, `audit has 3 assemblies (got ${audit.items.length})`);
  const it0 = audit.items[0];
  assert(it0.stages.length === 5 && it0.stages[0].qtyTotal === 2, 'per-stage qtyTotal = node 1 x order 2');
  assert(audit.totals.unitsTotal === 30 && audit.totals.unitsDone === 0, 'totals 0/30');
  assert(it0.profile === 'W310x52' && it0.weightKg === 312.5, 'fab columns surfaced');
  assert(!!it0.workOrderNumber && it0.status === 'not_started', 'item WO number + derived status');

  // ── QR scan resolver ──
  r = await fetch(`${A}/nodes/${audit.items[0].nodeId}/orders`, { headers: H });
  const resolved = await j(r);
  assert(
    resolved.node && resolved.node.mark === audit.items[0].mark && resolved.orders.some((o) => o.id === order.id),
    'QR resolver maps node → work orders',
  );

  // ── Bulk + single updates ──
  const stage1 = audit.stages[0];
  const nodeIds = audit.items.slice(0, 2).map((i) => i.nodeId);
  r = await fetch(`${A}/orders/${order.id}/stages/bulk`, { method: 'PATCH', headers: H, body: JSON.stringify({ stageId: stage1.id, nodeIds, status: 'completed' }) });
  const bulk = await j(r);
  assert(bulk.updated === 2 && bulk.failed.length === 0, `bulk completed 2 (got ${bulk.updated}/${bulk.requested})`);

  const wos3 = audit.items[2].stages[0];
  r = await fetch(`${A}/orders/${order.id}/stages/${wos3.wosId}`, { method: 'PATCH', headers: H, body: JSON.stringify({ qtyDone: 1 }) });
  assert(!!(await j(r)).id, 'single stage qtyDone=1');

  r = await fetch(`${A}/orders/${order.id}/audit`, { headers: H });
  audit = await j(r);
  const s1 = (m) => audit.items.find((i) => i.mark === m).stages[0];
  assert(s1('B1001').status === 'completed' && s1('B1001').qtyDone === 2, 'B1001 stage1 completed via bulk');
  assert(!!s1('B1001').statusUpdatedAt && !!s1('B1001').completedAt, 'audit stamps recorded');
  assert(s1('B1003').status === 'in_progress' && s1('B1003').qtyDone === 1, 'B1003 stage1 1/2 in progress');
  assert(audit.totals.unitsDone === 5, `totals unitsDone 2+2+1=5 (got ${audit.totals.unitsDone})`);
  assert(!!audit.items.find((i) => i.mark === 'B1001').lastActivityAt, 'lastActivityAt set');
  assert(audit.items.find((i) => i.mark === 'B1001').status === 'in_progress', 'item rollup in_progress');

  // ── Node audit (stage rows + trail) ──
  r = await fetch(`${A}/orders/${order.id}/nodes/${audit.items[0].nodeId}/audit`, { headers: H });
  const trail = await j(r);
  assert(Array.isArray(trail.timeEntries) && Array.isArray(trail.ncrs) && !!trail.workOrderNumber, 'node trail shape');
  assert(Array.isArray(trail.stages) && trail.stages.length === 5 && !!trail.stages[0].wosId, 'node audit includes stage rows');
  assert(trail.stages[0].status === 'completed' && trail.status === 'in_progress' && trail.percentComplete > 0, 'node audit rollup + stage status');

  // ── Stage-change history ──
  r = await fetch(`${A}/orders/${order.id}/events`, { headers: H });
  const feed = await j(r);
  assert(Array.isArray(feed) && feed.length >= 3, `events feed has entries (got ${feed.length})`);
  assert(!!feed[0].user, `event actor resolved (got ${feed[0].user})`);
  assert(feed.some((e) => e.action === 'bulk_status') && feed.some((e) => e.action === 'qty'), 'bulk + single actions recorded');
  assert(feed.every((e) => e.stageName && e.at), 'events carry stage name + timestamp');
  assert(trail.events.length >= 1 && trail.events[0].toStatus === 'completed', 'node audit includes its history');

  r = await fetch(`${A}/orders/${order.id}/stages/${wos3.wosId}`, { method: 'PATCH', headers: H, body: JSON.stringify({ qtyDone: 2, source: 'mobile' }) });
  await j(r);
  r = await fetch(`${A}/orders/${order.id}/events`, { headers: H });
  const feed2 = await j(r);
  assert(feed2[0].source === 'mobile' && feed2[0].toQty === 2, 'mobile source recorded on the trail');

  // ── Ship readiness lifecycle ──
  assert(audit.items.every((i) => i.shipStatus === 'in_production'), 'all in production before stages finish');
  for (const st of audit.stages) {
    r = await fetch(`${A}/orders/${order.id}/stages/bulk`, { method: 'PATCH', headers: H, body: JSON.stringify({ stageId: st.id, nodeIds: [audit.items[0].nodeId], status: 'completed' }) });
    await j(r);
  }
  r = await fetch(`${A}/orders/${order.id}/audit`, { headers: H });
  audit = await j(r);
  const b1 = audit.items.find((i) => i.mark === 'B1001');
  assert(b1.shipStatus === 'ready' && b1.shipReadyQty === 2, `B1001 ready to ship (${b1.shipStatus} ${b1.shipReadyQty})`);
  assert(audit.totals.readyToShip === 1, 'totals.readyToShip = 1');

  // ── NCR quality gate: pre-warn + enforcement ──
  r = await fetch(`${A}/projects/${project.id}/nodes/${audit.items[1].nodeId}/ncr`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'Weld porosity' }) });
  assert(!!(await j(r)).number, 'NCR raised on B1002');
  r = await fetch(`${A}/orders/${order.id}/audit`, { headers: H });
  audit = await j(r);
  const b2 = audit.items.find((i) => i.mark === 'B1002');
  assert(b2.openNcrs === 1, 'B1002 has an open NCR');
  const qcRow = b2.stages.find((s) => /qc|quality|inspect/i.test(s.name));
  assert(qcRow && qcRow.gateBlocked === true, 'QC stage pre-warned as gate-blocked');
  r = await fetch(`${A}/orders/${order.id}/stages/bulk`, { method: 'PATCH', headers: H, body: JSON.stringify({ stageId: qcRow.stageId, nodeIds: [b2.nodeId], status: 'completed' }) });
  const gateRes = await j(r);
  assert(gateRes.updated === 0 && gateRes.failed.length === 1, 'bulk respects the QC gate');

  // ── Validation + status sync ──
  r = await fetch(`${A}/orders/${order.id}/stages/bulk`, { method: 'PATCH', headers: H, body: JSON.stringify({ stageId: stage1.id, nodeIds }) });
  assert(r.status === 400, 'bulk without action rejected (400)');
  r = await fetch(`${A}/orders/${order.id}/stages/bulk`, { method: 'PATCH', headers: H, body: JSON.stringify({ stageId: audit.stages[1].id, nodeIds, qtyDone: 1 }) });
  assert((await j(r)).updated === 2, 'bulk qtyDone applied');
  r = await fetch(`${A}/orders/${order.id}`, { headers: H });
  assert((await j(r)).status === 'in_progress', 'order status auto-synced');

  // ── Cleanup ──
  r = await fetch(`${A}/orders/${order.id}`, { method: 'DELETE', headers: H });
  assert((await j(r)).ok === true, 'order deleted (cleanup)');
  r = await fetch(`${A}/projects/${project.id}`, { method: 'DELETE', headers: H });
  console.log(r.status < 300 ? `ok ${++n} - project deleted (cleanup)` : 'note: project left in place (NCR holds a reference) — fine on a scratch DB');

  await db.end();
  console.log(`ALL PASS (${n} checks)`);
  process.exit(0);
})().catch((e) => { console.error('ERROR', e.message || e); process.exit(1); });
