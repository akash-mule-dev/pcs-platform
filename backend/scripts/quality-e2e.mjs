/**
 * Quality module E2E suite (inspections, sign-off, NCR-as-QC-report, gates, SPC).
 *
 * Exercises the quality endpoints end to end against a RUNNING API:
 * record inspections (auto-fail + identity stamping) → sign-off permission +
 * stamping → raise an NCR-type QC report (template-driven) → resolve/reopen →
 * quality-stage gates (open NCR report → unsigned failure → hold point) →
 * insights → tenant isolation. NCRs are QC reports whose template type is `ncr`;
 * they block gates while unresolved and lift on Resolve.
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

  // NCRs are NCR-type QC reports now. Make an `ncr` template + a production order
  // to scope reports against, then raise a report against the node.
  r = await P('/templates', { name: 'E2E NCR', type: 'ncr', schema: { components: [] } });
  const ncrTpl = await j(r);
  assert(!!ncrTpl.id && ncrTpl.type === 'ncr', 'NCR template created');
  r = await P('/processes/standard', {});
  const proc = await j(r);
  assert(!!proc.id, 'standard process for gate tests');
  r = await P(`/projects/${project.id}/orders`, { processId: proc.id, quantity: 1 });
  const order = await j(r);
  assert(!!order.id, `production order created ${order.number}`);
  r = await P('/quality-reports', { templateId: ncrTpl.id, productionOrderId: order.id, assemblyNodeId: nodeId });
  const ncr1 = await j(r);
  assert(/^QR-\d{4}-\d{4}$/.test(ncr1.number) && ncr1.templateType === 'ncr', `NCR report numbered as a QC report (${ncr1.number})`);
  assert(!ncr1.resolvedAt, 'new NCR report is open (unresolved)');

  // ── Resolve / reopen lifecycle (only NCR-type reports can be resolved) ──────
  r = await P(`/quality-reports/${ncr1.id}/resolve`, {});
  assert(!!(await j(r)).resolvedAt, 'NCR report resolves (stamps resolvedAt)');
  r = await P(`/quality-reports/${ncr1.id}/reopen`, {});
  assert(!(await j(r)).resolvedAt, 'NCR report reopens (clears resolvedAt)');
  r = await P('/templates', { name: 'E2E Inspection', type: 'inspection', schema: { components: [] } });
  const inspTpl = await j(r);
  r = await P('/quality-reports', { templateId: inspTpl.id, productionOrderId: order.id });
  const inspReport = await j(r);
  r = await P(`/quality-reports/${inspReport.id}/resolve`, {});
  assert(r.status === 400, 'only NCR reports can be resolved');

  // ── Quality summary counts open NCR reports ────────────────────────────────
  r = await G(`/projects/${project.id}/quality-summary`);
  const summary = await j(r);
  assert(summary.totals.openNcr === 1, `quality summary counts open NCR reports (got ${summary.totals.openNcr})`);
  assert(summary.nodes[nodeId]?.openNcr === 1 && summary.nodes[nodeId]?.status === 'fail', 'per-node rollup has open NCR + fail status');

  // ── Idempotent creates (offline replay safety) ─────────────────────────────
  const ck = crypto.randomUUID();
  r = await P('/quality-data', { modelId, meshName: 'idem', status: 'pass', clientKey: ck });
  const idem1 = await j(r);
  r = await P('/quality-data', { modelId, meshName: 'idem', status: 'pass', clientKey: ck });
  const idem2 = await j(r);
  assert(idem1.id === idem2.id, 'same clientKey replay returns the original row');

  // ── Stage quality gates (open NCR report → unsigned failure → hold point) ──
  r = await G(`/orders/${order.id}/audit`);
  let audit = await j(r);
  const qcCol = audit.stages.find((s) => /qc|quality|inspect/i.test(s.name));
  assert(!!qcCol, `process has a quality stage (${qcCol?.name})`);
  const item1 = audit.items.find((i) => i.mark === 'B2001');
  const item2 = audit.items.find((i) => i.mark === 'B2003');
  assert(!!item1 && !!item2, 'both assemblies in the order');
  const qcRow1 = item1.stages.find((s) => s.stageId === qcCol.id);
  assert(qcRow1?.gateBlocked === true && /NCR/i.test(qcRow1?.gateReason ?? ''), 'audit pre-warns: B2001 QC gate-blocked by open NCR report');

  const bulkQc = (nodeIds) => U(`/orders/${order.id}/stages/bulk`, { stageId: qcCol.id, nodeIds, status: 'completed' });
  r = await bulkQc([nodeId]);
  let bulkRes = await j(r);
  assert(bulkRes.updated === 0 && /open NCR report/i.test(bulkRes.failed[0]?.message ?? ''), 'QC completion blocked by open NCR report');

  // Resolve the NCR report — next blocker should be the unsigned failure.
  r = await P(`/quality-reports/${ncr1.id}/resolve`, {});
  assert(!!(await j(r)).resolvedAt, 'NCR report resolved (Resolve lifts the gate)');

  r = await bulkQc([nodeId]);
  bulkRes = await j(r);
  assert(bulkRes.updated === 0 && /awaiting sign-off/i.test(bulkRes.failed[0]?.message ?? ''), 'QC completion blocked by unsigned failed inspection');

  r = await U(`/quality-data/${nodeQa.id}/signoff`, { status: 'approved', notes: 'accepted as concession' });
  assert((await j(r)).signoffStatus === 'approved', 'failed inspection approved (concession)');

  r = await bulkQc([nodeId]);
  bulkRes = await j(r);
  assert(bulkRes.updated === 1, 'QC stage completes once NCR reports resolved + failures resolved');

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

    // NCRs are QC reports now — verify cross-tenant isolation on quality-reports.
    r = await get(H2)('/quality-reports');
    const isoReports = await j(r);
    assert(Array.isArray(isoReports) && isoReports.length === 0, 'cross-tenant QC report list isolated');
    r = await get(H2)(`/quality-reports/${ncr1.id}`);
    assert(r.status === 404, 'cross-tenant QC report read blocked');
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
