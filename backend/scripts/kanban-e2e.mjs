/**
 * Stage-kanban E2E suite — asserts the kanban endpoint reflects the
 * count-based stage engine accurately.
 *
 * Flow: create project → import demo IFC (assembly tree) → create+release a
 * production order (per-assembly WOs + stages) → verify every card sits at its
 * first incomplete stage with correct units → record stage work (qty + status)
 * → verify the card MOVES columns and unit counts stay in lockstep with the
 * order board → drive one piece to completion → verify it lands in "done" →
 * verify filters (project, q) and auth.
 *
 *   API_URL=http://localhost:3000/api E2E_IFC=/path/demo_assembly.ifc \
 *   node backend/scripts/kanban-e2e.mjs
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const auth = await j(await fetch(`${A}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }));
  const token = auth.accessToken || auth.access_token || auth.token;
  assert(!!token, 'login returns a token');
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const HA = { Authorization: `Bearer ${token}` };
  const get = (u) => fetch(`${A}${u}`, { headers: HA });
  const post = (u, b) => fetch(`${A}${u}`, { method: 'POST', headers: H, body: JSON.stringify(b ?? {}) });
  const patch = (u, b) => fetch(`${A}${u}`, { method: 'PATCH', headers: H, body: JSON.stringify(b ?? {}) });

  assert((await fetch(`${A}/work-orders/kanban`)).status === 401, 'kanban requires auth (401 without token)');

  // ── Fixture: project + assembly tree + released production order ──
  const project = await j(await post('/projects', { name: `Kanban E2E ${Date.now()}` }));
  const proc = await j(await post('/processes/standard', {}));
  assert(!!project.id && !!proc.id, 'project + standard process ready');

  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(IFC)]), 'demo_assembly.ifc');
  const started = await j(await fetch(`${A}/projects/${project.id}/import-ifc`, { method: 'POST', headers: HA, body: fd }));
  for (let t = 0; t < 60; t++) {
    const d = await j(await get(`/projects/${project.id}/imports/${started.importFileId}`));
    if (d.file.status === 'completed' || d.file.status === 'failed') break;
    await sleep(500);
  }
  const order = await j(await post(`/projects/${project.id}/orders`, { processId: proc.id, customerName: 'Kanban Co', quantity: 2 }));
  assert(!!order.id, 'production order created + released');

  // ── Board accuracy: fresh order → every card at the FIRST stage, 0 done ──
  const kb = await j(await get(`/work-orders/kanban?projectId=${project.id}`));
  assert(kb.stages.length >= 3, `stage columns come from the process routing (${kb.stages.map((s) => s.name).join(' → ')})`);
  const firstStage = kb.stages[0].name;
  assert(kb.cards.length > 0, `cards exist (${kb.cards.length} pieces in production)`);
  assert(kb.cards.every((c) => c.currentStage && c.currentStage.name === firstStage),
    `every fresh card sits in the first column (${firstStage}) — current stage = first incomplete`);
  const card = kb.cards.find((c) => (c.currentStage.qtyTotal ?? 0) > 1) || kb.cards[0];
  assert(card.mark || card.nodeName, 'cards carry the piece mark/assembly name');
  assert(card.projectName === project.name && card.productionOrderNumber === order.number,
    'cards carry project + production-order context');
  assert(card.overall.unitsDone === 0 && card.overall.unitsTotal > 0,
    `overall units accurate for a fresh order (0/${card.overall.unitsTotal})`);
  assert(card.currentStage.qtyDone === 0 && card.currentStage.qtyTotal >= 2,
    `current-stage counts present (0/${card.currentStage.qtyTotal} at ${firstStage})`);

  // ── Record work: +1 unit → counts move, card stays until stage completes ──
  await j(await patch(`/orders/${order.id}/stages/${card.currentStage.wosId}`, { qtyDone: 1, source: 'api' }));
  let kb2 = await j(await get(`/work-orders/kanban?projectId=${project.id}`));
  let c2 = kb2.cards.find((c) => c.workOrderId === card.workOrderId);
  assert(c2.currentStage.name === firstStage && c2.currentStage.qtyDone === 1,
    'partial quantity keeps the card in its column with live counts (1 done)');
  assert(c2.overall.unitsDone === 1, 'overall units track recorded work');

  // Complete the stage → the card must MOVE to the next column.
  await j(await patch(`/orders/${order.id}/stages/${c2.currentStage.wosId}`, { status: 'completed', source: 'api' }));
  kb2 = await j(await get(`/work-orders/kanban?projectId=${project.id}`));
  c2 = kb2.cards.find((c) => c.workOrderId === card.workOrderId);
  const secondStage = kb.stages[1].name;
  assert(c2.currentStage.name === secondStage, `completing a stage moves the card to the next column (${secondStage})`);

  // Cross-check against the order board (same source of truth).
  const progress = await j(await get(`/orders/${order.id}/progress`));
  const kbUnitsDone = kb2.cards.filter((c) => c.productionOrderId === order.id).reduce((a, c) => a + c.overall.unitsDone, 0)
    + kb2.done.filter((c) => c.productionOrderId === order.id).reduce((a, c) => a + c.overall.unitsDone, 0);
  assert(kbUnitsDone === progress.unitsDone,
    `kanban units agree with the order progress endpoint (${kbUnitsDone} = ${progress.unitsDone})`);

  // ── Drive one piece all the way → it lands in Done ──
  const target = kb2.cards.find((c) => c.productionOrderId === order.id);
  const audit = await j(await get(`/orders/${order.id}/audit`));
  const item = audit.items.find((i) => i.workOrderId === target.workOrderId);
  assert(!!item, 'kanban card maps to an order-audit item (same work order)');
  for (const s of item.stages) {
    if (s.status !== 'completed' && s.status !== 'skipped') {
      await j(await patch(`/orders/${order.id}/stages/${s.wosId}`, { status: 'completed', source: 'api' }));
    }
  }
  const kb3 = await j(await get(`/work-orders/kanban?projectId=${project.id}`));
  assert(!kb3.cards.some((c) => c.workOrderId === target.workOrderId), 'fully completed piece leaves the stage columns');
  assert(kb3.done.some((c) => c.workOrderId === target.workOrderId), 'fully completed piece appears in Done');
  assert(kb3.doneTotal === kb2.doneTotal + 1 && kb3.totals.active === kb2.totals.active - 1,
    'done/active totals stay consistent');

  // ── Filters ──
  const other = await j(await post('/projects', { name: `Kanban E2E empty ${Date.now()}` }));
  const kbEmpty = await j(await get(`/work-orders/kanban?projectId=${other.id}`));
  assert(kbEmpty.cards.length === 0 && kbEmpty.doneTotal === 0, 'project filter scopes the board');
  const term = (target.mark || target.productionOrderNumber || target.orderNumber).slice(0, 6).toLowerCase();
  const kbQ = await j(await get(`/work-orders/kanban?projectId=${project.id}&q=${encodeURIComponent(term)}`));
  const qRows = kbQ.cards.concat(kbQ.done);
  assert(qRows.length > 0 && qRows.every((c) =>
    (c.mark || '').toLowerCase().includes(term)
    || (c.nodeName || '').toLowerCase().includes(term)
    || (c.orderNumber || '').toLowerCase().includes(term)
    || (c.productionOrderNumber || '').toLowerCase().includes(term)),
    `q filter narrows cards to matches ('${term}', ${qRows.length} hit(s))`);

  console.log(`\n${n} assertions passed — stage kanban is accurate`);
  process.exit(0);
})().catch((e) => {
  console.error('SUITE ERROR:', e);
  process.exit(1);
});
