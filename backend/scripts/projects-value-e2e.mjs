/**
 * Projects high-value features E2E: revision diff + impact, earned value,
 * per-piece documents (shop drawings), heat-number traceability + MTR rollup.
 *
 *   API_URL=http://localhost:3000/api E2E_IFC=/path/demo_assembly.ifc \
 *   node backend/scripts/projects-value-e2e.mjs
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
  const del = (u) => fetch(`${A}${u}`, { method: 'DELETE', headers: HA });

  const importIfc = async (projectId, name) => {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(IFC)]), name);
    const started = await j(await fetch(`${A}/projects/${projectId}/import-ifc`, { method: 'POST', headers: HA, body: fd }));
    for (let t = 0; t < 80; t++) {
      const d = await j(await get(`/projects/${projectId}/imports/${started.importFileId}`));
      if (d.file.status === 'completed' || d.file.status === 'failed') return d.file;
      await sleep(400);
    }
    throw new Error('import did not finish');
  };

  // ── Fixture ──
  const project = await j(await post('/projects', { name: `Value E2E ${Date.now()}` }));
  const proc = await j(await post('/processes/standard', {}));
  assert(!!project.id && !!proc.id, 'project + standard process ready');

  // ── 1. Revision diff: initial import ──
  const imp1 = await importIfc(project.id, 'rev-a.ifc');
  assert(imp1.status === 'completed', 'initial import completes');
  const rev1 = await j(await get(`/projects/${project.id}/imports/${imp1.id}/revision`));
  assert(rev1.diff && rev1.diff.initial === true, 'first import marked as initial revision');
  assert(rev1.diff.counts.added === imp1.nodeCount && rev1.diff.counts.changed === 0,
    `initial diff counts all ${imp1.nodeCount} nodes as added`);
  assert(rev1.impact && rev1.impact.summary.pieces === 0, 'initial import has no production impact');

  // ── 2. Revision diff: identical re-import → no changes ──
  const imp2 = await importIfc(project.id, 'rev-a-reimport.ifc');
  const rev2 = await j(await get(`/projects/${project.id}/imports/${imp2.id}/revision`));
  assert(rev2.diff.initial === false, 're-import is not initial');
  assert(rev2.diff.counts.added === 0 && rev2.diff.counts.changed === 0 && rev2.diff.counts.missing === 0,
    'identical re-import: no added/changed/missing');
  assert(rev2.diff.counts.unchanged === imp1.nodeCount, 'all nodes recognized as unchanged (idempotent by GUID)');

  // ── 3. Earned value: complete one piece → it shows up weekly ──
  const order = await j(await post(`/projects/${project.id}/orders`, { processId: proc.id, quantity: 1 }));
  const audit = await j(await get(`/orders/${order.id}/audit`));
  const item = audit.items[0];
  for (const s of item.stages) {
    if (s.status !== 'completed' && s.status !== 'skipped') {
      await j(await patch(`/orders/${order.id}/stages/${s.wosId}`, { status: 'completed', source: 'api' }));
    }
  }
  const ev = await j(await get(`/projects/${project.id}/earned-value`));
  assert(ev.kpis && ev.kpis.scopePieces > 0, `earned value scoped to released pieces (${ev.kpis.scopePieces})`);
  assert(Array.isArray(ev.series) && ev.series.length >= 1, 'weekly series produced');
  const week = ev.series[ev.series.length - 1];
  assert(week.producedPieces >= 1, 'completed piece lands in the weekly produced bucket');
  const evOrder = await j(await get(`/projects/${project.id}/earned-value?orderId=${order.id}`));
  assert(evOrder.kpis.scopePieces === audit.items.length, 'order filter scopes the earned-value report');

  // ── 4. Documents (shop drawings) per node ──
  const nodes = await j(await get(`/projects/${project.id}/nodes`));
  const part = nodes.find((x) => x.nodeType === 'part') || nodes[0];
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj <</Type/Catalog>> endobj\ntrailer <<>>\n%%EOF\n');
  const fd = new FormData();
  fd.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'shop-drawing-B1.pdf');
  fd.append('label', 'Rev A shop drawing');
  const up = await fetch(`${A}/projects/${project.id}/nodes/${part.id}/documents`, { method: 'POST', headers: HA, body: fd });
  const doc = await j(up);
  assert(up.status === 201 && doc.id, 'PDF attaches to a piece');
  assert(doc.label === 'Rev A shop drawing' && doc.contentType === 'application/pdf', 'document keeps label + content type');
  const docs = await j(await get(`/projects/${project.id}/nodes/${part.id}/documents`));
  assert(docs.length === 1 && docs[0].id === doc.id, 'document listed on the node');
  const fileRes = await get(`/projects/${project.id}/documents/${doc.id}/file`);
  const body = Buffer.from(await fileRes.arrayBuffer());
  assert(fileRes.status === 200 && body.equals(pdfBytes), 'document streams back byte-identical');
  const badFd = new FormData();
  badFd.append('file', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'notes.txt');
  const bad = await fetch(`${A}/projects/${project.id}/nodes/${part.id}/documents`, { method: 'POST', headers: HA, body: badFd });
  assert(bad.status === 400, 'non-drawing file types rejected (400)');
  await j(await del(`/projects/${project.id}/documents/${doc.id}`));
  const docs2 = await j(await get(`/projects/${project.id}/nodes/${part.id}/documents`));
  assert(docs2.length === 0, 'document removable');

  // ── 5. Heat-number traceability + shipment MTR ──
  const mat = await j(await post('/materials', { code: `HEA200-${Date.now()}`, name: 'HEA200 S355', type: 'bar' }));
  const lot = await j(await post('/traceability/lots', { materialId: mat.id, lotNumber: `LOT-${Date.now()}`, heatNumber: 'H-778899', supplier: 'ArcelorMittal', receivedQuantity: 100 }));
  assert(!!lot.id, 'material lot (heat #) created');
  const lotOptions = await j(await get(`/projects/${project.id}/lots?q=H-7788`));
  assert(lotOptions.some((l) => l.id === lot.id), 'lot searchable for assignment');

  const completedNode = nodes.find((x) => x.id === item.nodeId) || part;
  await j(await post(`/projects/${project.id}/nodes/${completedNode.id}/lots`, { materialLotId: lot.id }));
  const nodeLots = await j(await get(`/projects/${project.id}/nodes/${completedNode.id}/lots`));
  assert(nodeLots.length === 1 && nodeLots[0].heat_number === 'H-778899', 'heat number assigned to the piece');

  const shipment = await j(await post('/shipments', { projectId: project.id, shipmentNumber: `LOAD-E2E-${Date.now()}` }));
  await j(await post(`/shipments/${shipment.id}/items`, { assemblyNodeId: completedNode.id, quantity: 1 }));
  const mtr = await j(await get(`/projects/${project.id}/shipments/${shipment.id}/traceability`));
  assert(mtr.summary.items === 1 && mtr.summary.covered === 1 && mtr.summary.missing === 0,
    'shipment MTR rollup covers the item via its heat number');
  assert(mtr.items[0].lots.some((l) => l.heatNumber === 'H-778899'), 'MTR lists the heat number + cert chain');

  // ── 6. Delivery note / packing slip ──
  const dn = await j(await get(`/shipments/${shipment.id}/delivery-note`));
  assert(dn.shipment.number === shipment.shipmentNumber && dn.project.name === project.name,
    'delivery note carries project + load header');
  assert(dn.items.length === 1 && dn.items[0].quantity === 1, 'delivery note itemizes the shipped assemblies');
  assert(dn.totals.lines === 1 && dn.totals.pieces === 1, 'delivery note totals match the load');
  assert(dn.items[0].heats.some((h) => h.heatNumber === 'H-778899'),
    'delivery note folds in the heat number (doubles as MTR cover sheet)');
  const dnNoHeats = await j(await get(`/shipments/${shipment.id}/delivery-note?heats=false`));
  assert(dnNoHeats.items[0].heats.length === 0, 'heats can be omitted from the slip');

  // ── Scoping ──
  const other = await j(await post('/projects', { name: `Value E2E B ${Date.now()}` }));
  const cross = await get(`/projects/${other.id}/imports/${imp1.id}/revision`);
  assert(cross.status === 404, 'revision not readable through a different project (404)');

  console.log(`\n${n} assertions passed — projects value features OK`);
  process.exit(0);
})().catch((e) => {
  console.error('SUITE ERROR:', e);
  process.exit(1);
});
