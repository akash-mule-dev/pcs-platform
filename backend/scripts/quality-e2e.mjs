/**
 * Quality module E2E suite (inspections, sign-off, NCR lifecycle, CAPA, SPC).
 *
 * Exercises the quality endpoints end to end against a RUNNING API:
 * record inspections (auto-fail + identity stamping) → sign-off permission +
 * stamping → NCR raise (numbering, events) → workflow state machine (legal +
 * illegal transitions, disposition-gated close, reopen) → comments/timeline →
 * CAPA verify-before-close → list filters → tenant isolation of numbering.
 *
 * ⚠ Run against a SCRATCH database only — it writes fixtures via SQL.
 *
 *   E2E_PG_URL=postgresql://postgres@localhost:5433/pcs \
 *   API_URL=http://localhost:3000/api \
 *   npm run test:e2e:quality
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

const post = (H) => (url, body) => fetch(`${A}${url}`, { method: 'POST', headers: H, body: JSON.stringify(body ?? {}) });
const patch = (H) => (url, body) => fetch(`${A}${url}`, { method: 'PATCH', headers: H, body: JSON.stringify(body ?? {}) });
const get = (H) => (url) => fetch(`${A}${url}`, { headers: H });

(async () => {
  const db = new pg.Client({ connectionString: PG_URL });
  await db.connect();

  // Fixture: ensure the login user belongs to an organization (fresh seeds bootstrap one).
  const org = await db.query(
    `INSERT INTO organizations (name, slug) VALUES ('QA E2E Org','qa-e2e-org')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const orgId = org.rows[0].id;
  await db.query(`UPDATE users SET organization_id = $1 WHERE organization_id IS NULL AND email <> 'platform@pcs.com'`, [orgId]);

  let r = await fetch(`${A}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const login = await j(r);
  assert(!!login.accessToken, 'login (admin)');
  const H = { 'content-type': 'application/json', authorization: `Bearer ${login.accessToken}` };
  const userOrg = login.user?.organizationId ?? orgId;
  const P = post(H), U = patch(H), G = get(H);

  // ── Fixtures: model + project + node ───────────────────────────────────────
  const model = await db.query(
    `INSERT INTO models (name, file_name, original_name, file_path, file_size, mime_type, model_type)
     VALUES ('QA E2E Model','qa.glb','qa.glb','qa/qa.glb',12,'model/gltf-binary','quality') RETURNING id`,
  );
  const modelId = model.rows[0].id;

  r = await P('/projects', { name: `QA E2E ${Date.now()}` });
  const project = await j(r);
  assert(!!project.id, 'project created');

  const node = await db.query(
    `INSERT INTO assembly_nodes (project_id, organization_id, node_type, name, mark, quantity, depth, sort_index, model_id, mesh_name)
     VALUES ($1,$2,'assembly','B2001','B2001',1,0,0,$3,'B2001-mesh') RETURNING id`,
    [project.id, userOrg, modelId],
  );
  const nodeId = node.rows[0].id;
  const node2 = await db.query(
    `INSERT INTO assembly_nodes (project_id, organization_id, node_type, name, mark, quantity, depth, sort_index, model_id, mesh_name)
     VALUES ($1,$2,'assembly','B2003','B2003',1,0,1,$3,'B2003-mesh') RETURNING id`,
    [project.id, userOrg, modelId],
  );
  const node2Id = node2.rows[0].id;

  // ── Inspections: identity stamping + auto-fail ─────────────────────────────
  r = await P('/quality-data', { modelId, meshName: 'm1', status: 'pass', measurementValue: 13, toleranceMin: 12, toleranceMax: 14 });
  const passEntry = await j(r);
  assert(r.status === 201 && passEntry.status === 'pass', 'in-tolerance entry stays pass');
  assert(!!passEntry.inspectorUserId, 'inspector identity stamped from JWT');
  assert(!!passEntry.inspector, `inspector display name defaulted (${passEntry.inspector})`);

  r = await P('/quality-data', { modelId, meshName: 'm2', status: 'pass', measurementValue: 20, toleranceMin: 12, toleranceMax: 14, severity: 'high' });
  const autoFail = await j(r);
  assert(autoFail.status === 'fail', 'out-of-tolerance auto-fails');

  // Bulk create now applies the same rule.
  r = await P('/quality-data/bulk', { items: [
    { modelId, meshName: 'b1', status: 'pass', measurementValue: 50, toleranceMax: 10 },
    { modelId, meshName: 'b2', status: 'warning' },
  ] });
  const bulk = await j(r);
  assert(Array.isArray(bulk) && bulk[0].status === 'fail' && bulk[1].status === 'warning', 'bulk create applies auto-fail per row');
  assert(bulk.every((b) => b.organizationId === userOrg), 'bulk rows tenant-stamped');

  // Update cannot sneak an out-of-tolerance value back to pass.
  r = await U(`/quality-data/${autoFail.id}`, { status: 'pass' });
  const sneaky = await j(r);
  assert(sneaky.status === 'fail', 'update re-applies tolerance auto-fail');

  // Linkage is immutable + cross-org links rejected.
  r = await P('/quality-data', { modelId, meshName: 'm3', status: 'pass', assemblyNodeId: '00000000-0000-0000-0000-000000000001' });
  assert(r.status === 400, 'create rejects unknown assembly link');

  // ── Sign-off: permission + server-side identity ────────────────────────────
  r = await G(`/quality-data/pending-signoffs?modelId=${modelId}`);
  const pending = await j(r);
  assert(pending.some((p) => p.id === autoFail.id), 'failed entry appears in pending sign-offs');

  r = await U(`/quality-data/${autoFail.id}/signoff`, { status: 'approved', signoffBy: 'Spoofed Name', notes: 'use as is after review' });
  const signed = await j(r);
  assert(signed.signoffStatus === 'approved', 'sign-off approved');
  assert(signed.signoffBy !== 'Spoofed Name' && !!signed.signoffByUserId, `sign-off identity stamped server-side (${signed.signoffBy})`);

  r = await U(`/quality-data/${autoFail.id}/signoff`, { status: 'bogus' });
  assert(r.status === 400, 'invalid sign-off status rejected');

  // ── Node-scoped quality + NCR raise ────────────────────────────────────────
  r = await P(`/projects/${project.id}/nodes/${nodeId}/quality`, { status: 'fail', defectType: 'weld undercut', severity: 'high' });
  const nodeQa = await j(r);
  assert(r.status === 201 && nodeQa.assemblyNodeId === nodeId, 'node-scoped inspection recorded');

  r = await P(`/projects/${project.id}/nodes/${nodeId}/ncr`, { qualityDataId: nodeQa.id });
  const ncr1 = await j(r);
  assert(/^NCR-\d{4}-0*1$/.test(ncr1.number), `NCR numbering starts at 0001 per org (${ncr1.number})`);
  assert(ncr1.severity === 'high', 'NCR severity inherited from quality record');
  assert(!!ncr1.raisedBy, 'raisedBy stamped from JWT');

  // ── Workflow state machine ─────────────────────────────────────────────────
  r = await U(`/ncr/${ncr1.id}`, { status: 'closed' });
  assert(r.status === 400, 'open → closed rejected (must pass disposition)');

  r = await U(`/ncr/${ncr1.id}`, { status: 'investigation' });
  assert((await j(r)).status === 'investigation', 'open → investigation');

  r = await U(`/ncr/${ncr1.id}`, { status: 'open' });
  assert(r.status === 400, 'investigation → open rejected');

  // (use_as_is here — the rework disposition's re-inspection rule has its own block below)
  r = await U(`/ncr/${ncr1.id}`, { status: 'disposition', disposition: 'use_as_is', dispositionNote: 'within tolerance stack-up' });
  assert((await j(r)).disposition === 'use_as_is', 'disposition recorded');

  r = await U(`/ncr/${ncr1.id}`, { status: 'cancelled' });
  assert(r.status === 400, 'cancel after disposition rejected');

  r = await U(`/ncr/${ncr1.id}`, { status: 'closed' });
  const closed = await j(r);
  assert(closed.status === 'closed' && !!closed.closedAt && !!closed.closedBy, 'disposition → closed stamps closedAt/closedBy');

  r = await U(`/ncr/${ncr1.id}`, { status: 'investigation' });
  const reopened = await j(r);
  assert(reopened.status === 'investigation' && !reopened.closedAt && !reopened.closedBy, 'reopen clears close stamp');

  r = await U(`/ncr/${ncr1.id}`, { status: 'disposition' });
  await j(r);
  r = await U(`/ncr/${ncr1.id}`, { status: 'closed' });
  assert((await j(r)).status === 'closed', 're-close after reopen');

  // ── Timeline + comments ────────────────────────────────────────────────────
  r = await P(`/ncr/${ncr1.id}/comments`, { note: 'Verified weld after rework — acceptable.' });
  assert(r.status === 201, 'comment added');
  r = await P(`/ncr/${ncr1.id}/comments`, { note: '   ' });
  assert(r.status === 400, 'blank comment rejected');

  r = await G(`/ncr/${ncr1.id}/events`);
  const events = await j(r);
  const types = events.map((e) => e.type);
  assert(types[0] === 'created', 'timeline starts with created');
  assert(types.filter((t) => t === 'status_change').length >= 5, `timeline records every transition (${types.filter((t) => t === 'status_change').length})`);
  assert(types.includes('disposition') && types.includes('comment'), 'timeline includes disposition + comment');
  assert(events.every((e) => e.actorName), 'events carry actor names');

  r = await G(`/ncr/${ncr1.id}`);
  const detail = await j(r);
  assert(Array.isArray(detail.allowedTransitions) && detail.allowedTransitions.join(',') === 'investigation', 'detail exposes legal next statuses');

  // ── Gates still respect open NCRs ──────────────────────────────────────────
  r = await P(`/projects/${project.id}/nodes/${nodeId}/ncr`, { title: 'Paint blistering' });
  const ncr2 = await j(r);
  assert(/^NCR-\d{4}-0*2$/.test(ncr2.number), `second NCR increments (${ncr2.number})`);

  r = await G(`/projects/${project.id}/quality-summary`);
  const summary = await j(r);
  assert(summary.totals.openNcr === 1, `quality summary counts only open NCRs (got ${summary.totals.openNcr})`);
  assert(summary.nodes[nodeId]?.openNcr === 1 && summary.nodes[nodeId]?.status === 'fail', 'per-node rollup has open NCR + fail status');

  // ── List filters ───────────────────────────────────────────────────────────
  r = await G(`/ncr?open=true`);
  const openList = await j(r);
  assert(openList.length === 1 && openList[0].id === ncr2.id, 'open=true filter');
  r = await G(`/ncr?severity=high`);
  assert((await j(r)).every((x) => x.severity === 'high'), 'severity filter');
  r = await G(`/ncr?q=${encodeURIComponent('Paint')}`);
  assert((await j(r)).some((x) => x.id === ncr2.id), 'q filter matches title');
  r = await G(`/ncr?projectId=${project.id}`);
  const byProject = await j(r);
  assert(byProject.length === 2 && byProject.every((x) => x.itemMark === 'B2001'), 'project filter + item mark enrichment');

  // ── CAPA verify-before-close ───────────────────────────────────────────────
  r = await P('/capa', { ncrId: ncr2.id, title: 'Improve paint booth humidity control', type: 'preventive' });
  const capa = await j(r);
  assert(!!capa.id, 'CAPA created');
  r = await U(`/capa/${capa.id}`, { status: 'closed' });
  assert(r.status === 400, 'CAPA close without verification rejected');
  r = await U(`/capa/${capa.id}`, { status: 'in_progress' });
  await j(r);
  r = await U(`/capa/${capa.id}`, { status: 'verified' });
  const verified = await j(r);
  assert(!!verified.verifiedBy && !!verified.verifiedAt, 'verification stamps verifier');
  r = await U(`/capa/${capa.id}`, { status: 'closed' });
  assert((await j(r)).status === 'closed', 'verified CAPA closes');

  // ── Idempotent creates (offline replay safety) ─────────────────────────────
  const ck = crypto.randomUUID();
  r = await P('/quality-data', { modelId, meshName: 'idem', status: 'pass', clientKey: ck });
  const idem1 = await j(r);
  r = await P('/quality-data', { modelId, meshName: 'idem', status: 'pass', clientKey: ck });
  const idem2 = await j(r);
  assert(idem1.id === idem2.id, 'same clientKey replay returns the original row');

  // ── Optimistic concurrency on NCRs ─────────────────────────────────────────
  r = await G(`/ncr/${ncr2.id}`);
  const v = (await j(r)).version;
  assert(Number.isInteger(v), `NCR carries a version (${v})`);
  r = await U(`/ncr/${ncr2.id}`, { title: 'Paint blistering (stale write)', expectedVersion: v + 5 });
  assert(r.status === 409, 'stale expectedVersion rejected with 409');
  r = await U(`/ncr/${ncr2.id}`, { title: 'Paint blistering — south rail', expectedVersion: v });
  assert((await j(r)).title.includes('south rail'), 'matching expectedVersion writes');

  // ── Pagination ─────────────────────────────────────────────────────────────
  r = await G('/ncr?limit=1');
  assert((await j(r)).length === 1, 'limit=1 caps the NCR list');

  // ── NCR photo evidence ─────────────────────────────────────────────────────
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'defect.png');
  r = await fetch(`${A}/ncr/${ncr2.id}/evidence`, { method: 'POST', headers: { authorization: H.authorization }, body: form });
  const withPhoto = await j(r);
  assert(r.status === 201 && (withPhoto.attachments?.length ?? 0) === 1, 'NCR photo attached');
  r = await fetch(`${A}/ncr/${ncr2.id}/evidence/0`, { headers: { authorization: H.authorization } });
  assert(r.ok && (r.headers.get('content-type') || '').includes('image/png'), 'NCR photo streams back as image/png');
  const badForm = new FormData();
  badForm.append('file', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'notes.txt');
  r = await fetch(`${A}/ncr/${ncr2.id}/evidence`, { method: 'POST', headers: { authorization: H.authorization }, body: badForm });
  assert(r.status === 400, 'non-image NCR evidence rejected');

  // ── Stage quality gates (NCR → unresolved failure → hold point) ───────────
  r = await P('/processes/standard', {});
  const proc = await j(r);
  assert(!!proc.id, 'standard process for gate tests');
  r = await P(`/projects/${project.id}/orders`, { processId: proc.id, quantity: 1 });
  const order = await j(r);
  assert(!!order.id, `production order created ${order.number}`);
  r = await G(`/orders/${order.id}/audit`);
  let audit = await j(r);
  const qcCol = audit.stages.find((s) => /qc|quality|inspect/i.test(s.name));
  assert(!!qcCol, `process has a quality stage (${qcCol?.name})`);
  const item1 = audit.items.find((i) => i.mark === 'B2001');
  const item2 = audit.items.find((i) => i.mark === 'B2003');
  assert(!!item1 && !!item2, 'both assemblies in the order');
  const qcRow1 = item1.stages.find((s) => s.stageId === qcCol.id);
  assert(qcRow1?.gateBlocked === true && /NCR/i.test(qcRow1?.gateReason ?? ''), 'audit pre-warns: B2001 QC gate-blocked by open NCR');

  const bulkQc = (nodeIds) => U(`/orders/${order.id}/stages/bulk`, { stageId: qcCol.id, nodeIds, status: 'completed' });
  r = await bulkQc([nodeId]);
  let bulkRes = await j(r);
  assert(bulkRes.updated === 0 && /open NCR/i.test(bulkRes.failed[0]?.message ?? ''), 'QC completion blocked by open NCR');

  // Close the open NCR (use-as-is) — next blocker should be the unsigned failure.
  r = await U(`/ncr/${ncr2.id}`, { status: 'disposition', disposition: 'use_as_is' });
  await j(r);
  r = await U(`/ncr/${ncr2.id}`, { status: 'closed' });
  assert((await j(r)).status === 'closed', 'paint NCR closed (use-as-is)');

  r = await bulkQc([nodeId]);
  bulkRes = await j(r);
  assert(bulkRes.updated === 0 && /awaiting sign-off/i.test(bulkRes.failed[0]?.message ?? ''), 'QC completion blocked by unsigned failed inspection');

  r = await U(`/quality-data/${nodeQa.id}/signoff`, { status: 'approved', notes: 'accepted as concession' });
  assert((await j(r)).signoffStatus === 'approved', 'failed inspection approved (concession)');

  r = await bulkQc([nodeId]);
  bulkRes = await j(r);
  assert(bulkRes.updated === 1, 'QC stage completes once NCRs closed + failures resolved');

  // Hold point: stage requires a recorded inspection.
  await db.query(`UPDATE stages SET requires_inspection = true WHERE id = $1`, [qcCol.id]);
  r = await bulkQc([node2Id]);
  bulkRes = await j(r);
  assert(bulkRes.updated === 0 && /requires a recorded inspection/i.test(bulkRes.failed[0]?.message ?? ''), 'hold-point stage blocks uninspected assembly');
  r = await P(`/projects/${project.id}/nodes/${node2Id}/quality`, { status: 'pass', notes: 'visual OK' });
  assert(r.status === 201, 'inspection recorded on B2003');
  r = await bulkQc([node2Id]);
  bulkRes = await j(r);
  assert(bulkRes.updated === 1, 'hold-point stage completes after inspection');
  // Reset the flag — /processes/standard may be shared with other suites.
  await db.query(`UPDATE stages SET requires_inspection = false WHERE id = $1`, [qcCol.id]);

  // ── Rework loop: rework disposition demands a post-disposition re-inspection ──
  r = await P('/ncr', { title: 'Weld undercut — rework', assemblyNodeId: nodeId, projectId: project.id, severity: 'medium' });
  const reworkNcr = await j(r);
  r = await U(`/ncr/${reworkNcr.id}`, { status: 'disposition', disposition: 'rework', dispositionNote: 'grind + reweld' });
  await j(r);
  r = await U(`/ncr/${reworkNcr.id}`, { status: 'closed' });
  assert(r.status === 400 && /Rework must be verified/i.test((await r.text())), 'rework NCR cannot close without re-inspection');
  r = await P(`/projects/${project.id}/nodes/${nodeId}/quality`, { status: 'pass', notes: 're-inspected after reweld' });
  assert(r.status === 201, 're-inspection recorded');
  r = await U(`/ncr/${reworkNcr.id}`, { status: 'closed' });
  assert((await j(r)).status === 'closed', 'rework NCR closes after verified re-inspection');

  // ── SPC (XmR) + insights ───────────────────────────────────────────────────
  r = await G(`/spc/control-chart?modelId=${modelId}`);
  const spcPicker = await j(r);
  assert(Array.isArray(spcPicker.characteristics) && spcPicker.characteristics.length > 0, 'SPC lists characteristics when no mesh picked');
  const mesh = spcPicker.characteristics[0].meshName;
  r = await G(`/spc/control-chart?modelId=${modelId}&meshName=${encodeURIComponent(mesh)}`);
  const spcChart = await j(r);
  assert(spcChart.count >= 1 && !!spcChart.sigmaMethod, `SPC chart computed (n=${spcChart.count}, σ via ${spcChart.sigmaMethod})`);

  r = await G('/quality-data/insights');
  const insights = await j(r);
  assert(insights.firstPassYield && typeof insights.firstPassYield.inspectedNodes === 'number', 'insights: first-pass yield');
  assert(insights.ncrAging && typeof insights.ncrAging.under7 === 'number', 'insights: NCR aging buckets');
  assert(Array.isArray(insights.topDefects), 'insights: defect Pareto');

  // ── Tenant isolation: numbering + reads ────────────────────────────────────
  // Provision a second tenant via the platform operator, then verify nothing
  // from the first tenant is visible (and NCR numbering restarts at 0001).
  r = await fetch(`${A}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.E2E_PLATFORM_EMAIL || 'platform@pcs.com', password: PASSWORD }),
  });
  if (r.ok) {
    const platform = await j(r);
    const HP = { 'content-type': 'application/json', authorization: `Bearer ${platform.accessToken}` };
    const stamp = Date.now();
    const isoEmail = `qa-iso-${stamp}@e2e.test`;
    r = await post(HP)('/organizations', {
      name: 'QA Iso Org', slug: `qa-iso-${stamp}`,
      initialAdmin: { email: isoEmail, password: 'Str0ng!Passw0rd', firstName: 'Iso', lastName: 'Admin', employeeId: `ISO-${stamp}` },
    });
    const iso = await j(r);
    assert(!!iso?.initialAdmin?.id, 'second organization + bootstrap admin created');

    r = await fetch(`${A}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: isoEmail, password: 'Str0ng!Passw0rd' }),
    });
    const isoLogin = await j(r);
    assert(!!isoLogin.accessToken, 'second tenant admin login');
    const H2 = { 'content-type': 'application/json', authorization: `Bearer ${isoLogin.accessToken}` };

    r = await post(H2)('/ncr', { title: 'Other-tenant NCR' });
    const otherNcr = await j(r);
    assert(/^NCR-\d{4}-0*1$/.test(otherNcr.number), `tenant numbering independent (${otherNcr.number})`);
    r = await get(H2)(`/ncr/${ncr2.id}`);
    assert(r.status === 404, 'cross-tenant NCR read blocked');
    r = await get(H2)('/ncr');
    assert((await j(r)).length === 1, 'cross-tenant NCR list isolated');
    r = await get(H2)(`/quality-data/summary/${modelId}`);
    const isoSummary = await j(r);
    assert(isoSummary.total === 0, 'cross-tenant quality summary isolated');
    r = await get(H2)(`/quality-data/${passEntry.id}`);
    assert(r.status === 404, 'cross-tenant quality entry read blocked');
  } else {
    console.log('  (skipping tenant isolation block — platform login unavailable)');
  }

  console.log(`\nquality-e2e: all ${n} assertions passed`);
  await db.end();
  process.exit(0);
})().catch((e) => {
  console.error('quality-e2e crashed:', e);
  process.exit(1);
});
