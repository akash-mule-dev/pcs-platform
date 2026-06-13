/**
 * Costing + inventory E2E suite — asserts the full chain end to end:
 *
 *   import IFC → per-unit material requirements (BOM from the assembly tree)
 *   → one-click material-master sync → moving-average receipts → order
 *   requirements (× order quantity) + stock coverage → issue/return against
 *   the order (stamped costs, over-issue guard, closed-order guard) → labor
 *   (clocked time × worker→stage→default rate) → overhead % → cost roll-ups
 *   (work order / order / project / org overview) with estimates.
 *
 *   API_URL=http://localhost:3000/api E2E_IFC=/path/demo_assembly.ifc \
 *   node backend/scripts/costing-e2e.mjs
 *
 * Run against a freshly seeded scratch API only.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const A = process.env.API_URL || 'http://localhost:3000/api';
const EMAIL = process.env.E2E_EMAIL || 'admin@pcs.com';
const PASSWORD = process.env.E2E_PASSWORD || 'changeme-dev-only';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const IFC = process.env.E2E_IFC || path.join(HERE, '..', '..', 'demo-assembly', 'demo_assembly.ifc');

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
const close = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) <= eps;
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const auth = await j(await fetch(`${A}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }));
  const token = auth.accessToken || auth.access_token || auth.token;
  assert(!!token, 'login returns a token');
  const me = auth.user?.id;
  assert(!!me, 'login returns the user id');
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const HA = { Authorization: `Bearer ${token}` };
  const get = (u) => fetch(`${A}${u}`, { headers: HA });
  const post = (u, b) => fetch(`${A}${u}`, { method: 'POST', headers: H, body: JSON.stringify(b ?? {}) });
  const put = (u, b) => fetch(`${A}${u}`, { method: 'PUT', headers: H, body: JSON.stringify(b ?? {}) });
  const patch = (u, b) => fetch(`${A}${u}`, { method: 'PATCH', headers: H, body: JSON.stringify(b ?? {}) });

  assert((await fetch(`${A}/costing/settings`)).status === 401, 'costing requires auth (401 without token)');

  // ── Fixture: project + imported assembly tree ───────────────────────────────
  const project = await j(await post('/projects', { name: `Costing E2E ${Date.now()}` }));
  const proc = await j(await post('/processes/standard', {}));
  assert(!!project.id && !!proc.id, 'project + standard process ready');

  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(IFC)]), 'demo_assembly.ifc');
  await j(await fetch(`${A}/projects/${project.id}/import-ifc`, { method: 'POST', headers: HA, body: fd }));
  let imported = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const imports = await j(await get(`/projects/${project.id}/imports`));
    const row = (imports.imports ?? imports ?? [])[0];
    if (row && ['completed', 'failed'].includes(row.status)) { imported = row.status === 'completed'; break; }
  }
  assert(imported, 'IFC import pipeline completed');

  // The demo fixture has profiles/grades but no quantities-of-weight — backfill
  // deterministic design facts directly (scratch DB), like the other suites do.
  if (process.env.E2E_PG_URL) {
    const { default: pgPkg } = await import('pg');
    const client = new (pgPkg.Client ?? pgPkg.default.Client)({ connectionString: process.env.E2E_PG_URL });
    await client.connect();
    await client.query(
      `UPDATE assembly_nodes SET weight_kg = 100, length_mm = 6000 WHERE project_id = $1 AND node_type = 'part'`,
      [project.id],
    );
    await client.end();
    console.log('# backfilled part weights (100 kg / 6000 mm each) for deterministic costing');
  }

  // ── Per-unit requirements (BOM) ─────────────────────────────────────────────
  let req = await j(await get(`/projects/${project.id}/material-requirements`));
  assert(req.perUnit === true && req.lines.length > 0, `project BOM derived from the tree (${req.lines.length} lines)`);
  assert(req.totals.unmappedLines === req.lines.length, 'fresh org: every BOM line starts unmapped');
  assert(req.totals.weightKg > 0, `BOM carries tonnage (${req.totals.weightKg} kg/unit)`);
  assert(req.lines.every((l) => l.estimatedCost === null), 'unmapped lines have no cost estimate');

  // ── Material-master sync ────────────────────────────────────────────────────
  const sync = await j(await post(`/projects/${project.id}/material-requirements/sync-materials`));
  assert(sync.created.length === req.totals.unmappedLines - (req.lines.some((l) => !l.profile && !l.materialGrade) ? 1 : 0)
    || sync.created.length > 0, `sync created material masters (${sync.created.length})`);
  const sync2 = await j(await post(`/projects/${project.id}/material-requirements/sync-materials`));
  assert(sync2.created.length === 0, 'sync is idempotent (second run creates nothing)');

  req = await j(await get(`/projects/${project.id}/material-requirements`));
  const line = req.lines.find((l) => l.material && l.requiredQty > 0);
  assert(!!line, 'BOM lines are now mapped to material masters');
  const matId = line.material.id;

  // ── Moving-average receipts ─────────────────────────────────────────────────
  await j(await post('/inventory/receive', { materialId: matId, quantity: 10000, unitCost: 1.5, reference: 'PO-1' }));
  await j(await post('/inventory/receive', { materialId: matId, quantity: 10000, unitCost: 2.5, reference: 'PO-2' }));
  const summary = await j(await get('/inventory/summary'));
  const sRow = summary.materials.find((m) => m.id === matId);
  assert(close(sRow.unitCost, 2.0), `moving average blends receipts (10k@1.50 + 10k@2.50 → ${sRow.unitCost}/unit = 2.00)`);
  assert(close(sRow.onHand, 20000), 'on-hand accumulates receipts');
  assert(close(sRow.value, 40000), 'stock value = on-hand × avg cost');

  req = await j(await get(`/projects/${project.id}/material-requirements`));
  const priced = req.lines.find((l) => l.material?.id === matId);
  assert(close(priced.estimatedCost, r2(priced.requiredQty * 2.0)), 'per-unit estimate = required qty × avg cost');

  // ── Order requirements (× quantity) ─────────────────────────────────────────
  const order = await j(await post(`/projects/${project.id}/orders`, { processId: proc.id, quantity: 2 }));
  assert(!!order.id, 'production order (qty 2) created + released');
  let oreq = await j(await get(`/orders/${order.id}/material-requirements`));
  assert(oreq.orderQuantity === 2, 'order requirements carry the order quantity');
  const oline = oreq.lines.find((l) => l.material?.id === matId);
  assert(close(oline.requiredQty, priced.requiredQty * 2, 0.05), `order requirement = per-unit × 2 (${oline.requiredQty})`);
  assert(oline.pieceCount === priced.pieceCount * 2, 'piece counts scale with order quantity');
  assert(oline.status === 'covered', 'stock coverage: on-hand covers the requirement');

  // ── Issue / over-issue / coverage transitions ───────────────────────────────
  const half = Math.max(0.01, r2(oline.requiredQty / 2));
  await j(await post('/inventory/issue', { materialId: matId, quantity: half, productionOrderId: order.id }));
  oreq = await j(await get(`/orders/${order.id}/material-requirements`));
  const afterIssue = oreq.lines.find((l) => l.material?.id === matId);
  assert(close(afterIssue.issuedQty, half, 0.05), 'issued quantity tracked per order');
  assert(close(afterIssue.remainingQty, oline.requiredQty - half, 0.1), 'remaining = required − issued');
  assert(close(afterIssue.issuedCost, r2(half * 2.0), 0.05), 'issued cost stamped at the moving average');

  const over = await post('/inventory/issue', { materialId: matId, quantity: 10_000_000, productionOrderId: order.id });
  assert(over.status === 400, 'over-issue beyond on-hand is rejected (400)');
  const badRef = await post('/inventory/issue', { materialId: matId, quantity: 1, productionOrderId: project.id });
  assert(badRef.status === 404, 'issuing against a non-order reference is rejected (404)');

  // ── Costing settings ────────────────────────────────────────────────────────
  let settings = await j(await get('/costing/settings'));
  assert(settings.configured === false && settings.defaultLaborRate > 0, 'settings default before configuration');
  settings = await j(await put('/costing/settings', { defaultLaborRate: 60, overheadPercent: 10, currency: 'EUR' }));
  assert(settings.configured === true && settings.defaultLaborRate === 60 && settings.overheadPercent === 10 && settings.currency === 'EUR',
    'settings saved (rate 60, overhead 10%, EUR)');
  const badCur = await put('/costing/settings', { currency: 'EUROS' });
  assert(badCur.status === 400, 'invalid currency rejected (400)');

  // ── Labor: clock time, then pin it to a deterministic 2h window ─────────────
  const board = await j(await get(`/orders/${order.id}/stage-board`));
  const item = board.items[0];
  const wosId = item.stages[0].workOrderStageId;
  const stageId = item.stages[0].stageId;
  assert(!!wosId && !!stageId, 'stage board exposes a work-order stage to clock into');

  const entry = await j(await post('/time-tracking/clock-in', { workOrderStageId: wosId }));
  await j(await post('/time-tracking/clock-out', { timeEntryId: entry.id }));
  const t0 = new Date('2026-01-05T08:00:00Z');
  const t1 = new Date('2026-01-05T10:00:00Z'); // 7200 s
  await j(await patch(`/time-tracking/${entry.id}`, { startTime: t0.toISOString(), endTime: t1.toISOString(), breakSeconds: 600 }));

  // Worker rate wins the chain.
  await j(await patch(`/users/${me}`, { hourlyRate: 90 }));
  let cost = await j(await get(`/costing/order/${order.id}`));
  const paidH = 6600 / 3600; // 2h − 10min break
  assert(cost.actual.laborSeconds === 6600, 'labor seconds = clocked minus breaks');
  assert(close(cost.actual.laborCost, r2(paidH * 90)), `labor costed at the WORKER rate (${cost.actual.laborCost} = 1.833h × 90)`);

  // Stage rate when the worker has none.
  await j(await patch(`/users/${me}`, { hourlyRate: 0 }));
  await j(await patch(`/stages/${stageId}`, { hourlyRate: 75 }));
  cost = await j(await get(`/costing/order/${order.id}`));
  assert(close(cost.actual.laborCost, r2(paidH * 75)), `labor falls back to the STAGE rate (${cost.actual.laborCost} = 1.833h × 75)`);

  // Default rate when neither is set.
  await j(await patch(`/stages/${stageId}`, { hourlyRate: 0 }));
  cost = await j(await get(`/costing/order/${order.id}`));
  assert(close(cost.actual.laborCost, r2(paidH * 60)), `labor falls back to the ORG DEFAULT (${cost.actual.laborCost} = 1.833h × 60)`);

  // ── Cost composition ────────────────────────────────────────────────────────
  assert(close(cost.actual.materialCost, r2(half * 2.0), 0.05), 'order material cost = net issued × stamped avg');
  assert(close(cost.actual.overheadCost, r2(cost.actual.laborCost * 0.10)), 'overhead = 10% on labor');
  assert(close(cost.actual.totalCost, r2(cost.actual.materialCost + cost.actual.laborCost + cost.actual.overheadCost)),
    'total = material + labor + overhead');
  assert(cost.estimate.laborCost > 0, 'labor estimate from stage target times × planned units');
  assert(close(cost.estimate.materialCost, oreq.totals.estimatedCost, 0.05), 'material estimate mirrors the order BOM estimate');
  assert(cost.currency === 'EUR', 'cost responses carry the configured currency');
  assert(close(cost.unattributedMaterialCost, cost.actual.materialCost, 0.05), 'order-level issues (no WO pin) read as unattributed');

  // Pin an issue to a specific work order — it must attribute to that item row.
  const woId = cost.items[0].workOrderId;
  await j(await post('/inventory/issue', { materialId: matId, quantity: 5, workOrderId: woId }));
  cost = await j(await get(`/costing/order/${order.id}`));
  const woRow = cost.items.find((i) => i.workOrderId === woId);
  assert(close(woRow.materialCost, r2(5 * 2.0), 0.05), 'work-order-pinned issue lands on that assembly row (and stamps the order automatically)');

  // ── Returns reverse cost ────────────────────────────────────────────────────
  const matBefore = cost.actual.materialCost;
  await j(await post('/inventory/return', { materialId: matId, quantity: 5, productionOrderId: order.id }));
  cost = await j(await get(`/costing/order/${order.id}`));
  assert(close(cost.actual.materialCost, r2(matBefore - 5 * 2.0), 0.05), 'returns reduce the order material cost at stamped value');

  // ── Per-WO, project + org roll-ups agree ────────────────────────────────────
  const woCost = await j(await get(`/costing/work-order/${woId}`));
  assert(woCost.labor.seconds === 6600 && woCost.workers.length === 1, 'work-order cost shows labor + per-worker breakdown');
  assert((await get(`/costing/work-order/${project.id}`)).status === 404, 'unknown work order → 404');

  const pCost = await j(await get(`/costing/project/${project.id}`));
  assert(pCost.orders.length === 1 && close(pCost.orders[0].totalCost, cost.actual.totalCost, 0.05),
    'project roll-up matches the order cost');
  assert(close(pCost.actual.totalCost, cost.actual.totalCost, 0.05), 'project totals = sum of its orders');

  const overview = await j(await get('/costing/orders'));
  const ovRow = overview.orders.find((o) => o.orderId === order.id);
  assert(!!ovRow && close(ovRow.totalCost, cost.actual.totalCost, 0.05), 'org-wide overview carries the same roll-up');

  // ── Closed orders refuse new consumption ────────────────────────────────────
  await j(await patch(`/orders/${order.id}`, { status: 'cancelled' }));
  const closedIssue = await post('/inventory/issue', { materialId: matId, quantity: 1, productionOrderId: order.id });
  assert(closedIssue.status === 400, 'issuing against a cancelled order is rejected (400)');
  const lateReturn = await post('/inventory/return', { materialId: matId, quantity: 1, productionOrderId: order.id });
  assert(lateReturn.ok, 'returns remain possible after the order closes');

  console.log(`\ncosting-e2e: ${n} assertions passed`);
  process.exit(0);
})().catch((e) => {
  console.error('FAIL (exception):', e);
  process.exit(1);
});
