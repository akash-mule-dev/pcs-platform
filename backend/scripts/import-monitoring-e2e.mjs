/**
 * Import-pipeline monitoring E2E suite.
 *
 * Exercises the async package-import pipeline end to end against a RUNNING API:
 * upload returns immediately after durable storage → live stage/progress
 * (uploaded → extracting → persisting → converting → completed) → monitoring
 * endpoints (history list, per-import event timeline, conversion snapshot) →
 * websocket room feed (join-project / import:progress, room-scoped) →
 * failure path (invalid IFC) → retry → per-project scoping.
 *
 *   API_URL=http://localhost:3000/api \
 *   E2E_IFC=/path/to/demo_assembly.ifc \
 *   node backend/scripts/import-monitoring-e2e.mjs
 *
 * Env: API_URL (default http://localhost:3000/api), E2E_EMAIL, E2E_PASSWORD,
 *      E2E_IFC (default ../../demo-assembly/demo_assembly.ifc),
 *      SCENARIO=happy|failure|all (default all).
 * The websocket checks need `socket.io-client` to be resolvable (NODE_PATH or
 * repo root install); they are skipped with a notice otherwise.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const A = process.env.API_URL || 'http://localhost:3000/api';
const EMAIL = process.env.E2E_EMAIL || 'admin@pcs.com';
const PASSWORD = process.env.E2E_PASSWORD || 'changeme-dev-only';
const SCENARIO = (process.env.SCENARIO || 'all').toLowerCase();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const IFC = process.env.E2E_IFC || path.join(HERE, '..', '..', 'demo-assembly', 'demo_assembly.ifc');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ── Login ──────────────────────────────────────────────────────────────
  const login = await fetch(`${A}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const auth = await j(login);
  const token = auth.accessToken || auth.access_token || auth.token;
  assert(!!token, 'login returns a token');
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const HA = { Authorization: `Bearer ${token}` };
  const get = (url) => fetch(`${A}${url}`, { headers: HA });
  const post = (url, body) => fetch(`${A}${url}`, { method: 'POST', headers: H, body: JSON.stringify(body ?? {}) });

  const uploadIfc = async (projectId, name, buf) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'application/octet-stream' }), name);
    return fetch(`${A}/projects/${projectId}/import-ifc`, { method: 'POST', headers: HA, body: fd });
  };

  /** Poll one import until terminal; asserts progress never goes backwards. */
  const followImport = async (projectId, importId, timeoutMs) => {
    const t0 = Date.now();
    let last = -1;
    const stages = new Set();
    for (;;) {
      const d = await j(await get(`/projects/${projectId}/imports/${importId}`));
      stages.add(d.file.stage);
      if (d.file.progress < last) {
        console.error(`FAIL: progress went backwards (${last} -> ${d.file.progress})`);
        process.exit(1);
      }
      last = d.file.progress;
      if (d.file.status === 'completed' || d.file.status === 'failed') return { detail: d, stages };
      if (Date.now() - t0 > timeoutMs) {
        console.error(`FAIL: import ${importId} not terminal after ${timeoutMs}ms (stage=${d.file.stage} ${d.file.progress}%)`);
        process.exit(1);
      }
      await sleep(400);
    }
  };

  // ── Auth gate ──────────────────────────────────────────────────────────
  const projRes = await j(await post('/projects', { name: `Import E2E ${Date.now()}` }));
  const projectId = projRes.id;
  assert(!!projectId, 'project created');
  const unauth = await fetch(`${A}/projects/${projectId}/imports`);
  assert(unauth.status === 401, 'imports list requires auth (401 without token)');
  const unauthMon = await fetch(`${A}/imports/monitor`);
  assert(unauthMon.status === 401, 'org monitor requires auth (401 without token)');

  // ── Optional websocket feed ────────────────────────────────────────────
  let ioClient = null;
  try { ioClient = (await import('socket.io-client')).io; } catch { console.log('# socket.io-client not resolvable — ws checks skipped'); }
  const wsEvents = [];
  const strayEvents = [];
  let wsJoined = null, wsStray = null;
  if (ioClient) {
    const base = A.replace('/api', '');
    wsJoined = ioClient(base, { transports: ['websocket'] });
    wsStray = ioClient(base, { transports: ['websocket'] });
    await new Promise((res) => wsJoined.on('connect', res));
    await new Promise((res) => wsStray.on('connect', res));
    wsJoined.emit('join-project', projectId);
    wsJoined.on('import:progress', (e) => wsEvents.push(e));
    wsStray.on('import:progress', (e) => strayEvents.push(e)); // never joined the room
    await sleep(200);
  }

  if (SCENARIO === 'happy' || SCENARIO === 'all') {
    // ── Happy path: upload returns immediately, pipeline completes ──────
    assert(fs.existsSync(IFC), `demo IFC exists at ${IFC}`);
    const buf = fs.readFileSync(IFC);
    const t0 = Date.now();
    const up = await uploadIfc(projectId, 'demo_assembly.ifc', buf);
    const upMs = Date.now() - t0;
    const started = await j(up);
    assert(up.status === 201 || up.status === 200, `upload accepted (${up.status})`);
    assert(!!started.importFileId, 'response carries importFileId');
    assert(started.status === 'uploaded' && (started.stage === 'queued' || started.stage === 'uploaded'),
      `response returns immediately, package queued for processing (stage=${started.stage})`);
    console.log(`# upload round-trip ${upMs}ms`);

    const list0 = await j(await get(`/projects/${projectId}/imports`));
    const row0 = list0.find((r) => r.id === started.importFileId);
    assert(!!row0, 'imports list shows the new package right away');
    assert(row0.originalName === 'demo_assembly.ifc' && row0.size === buf.length, 'list row carries name + size');
    assert(typeof row0.progress === 'number' && row0.stage, 'list row carries live stage + progress');

    // Org-wide monitor sees it live, with queue awareness
    const mon0 = await j(await get('/imports/monitor'));
    const monRow = mon0.active.find((r) => r.id === started.importFileId);
    assert(!!monRow && mon0.kpis.inProgress >= 1, 'org monitor shows the package among active pipelines');
    assert(monRow.projectName === projRes.name, 'monitor row carries the project name');
    assert(typeof monRow.ahead === 'number', 'monitor row carries its queue position (packages ahead)');

    const { detail, stages } = await followImport(projectId, started.importFileId, 60_000);
    const f = detail.file;
    assert(f.status === 'completed' && f.progress === 100, `pipeline completed at 100% (stages seen: ${[...stages].join(',')})`);
    assert(f.nodeCount > 0, `structure extracted (${f.nodeCount} nodes)`);
    assert(!!f.modelId, '3D model linked to the import');
    assert(!!f.finishedAt && f.durationMs > 0, 'finishedAt + durationMs recorded');

    // Event timeline (the history)
    const evs = detail.events;
    assert(evs.length >= 5, `event timeline recorded (${evs.length} events)`);
    const evStages = evs.map((e) => e.stage);
    for (const s of ['uploaded', 'queued', 'extracting', 'persisting', 'completed']) {
      assert(evStages.includes(s), `timeline contains the '${s}' stage`);
    }
    const times = evs.map((e) => new Date(e.createdAt).getTime());
    assert(times.every((t, i) => i === 0 || t >= times[i - 1]), 'timeline is chronologically ordered');
    assert(evs.every((e) => e.message && e.message.length > 0), 'every event has a human-readable message');
    assert(evs[evs.length - 1].progress === 100, 'final event carries 100%');
    assert(detail.conversion && detail.conversion.status === 'completed', 'conversion-job snapshot included and completed');

    // Tree actually linked
    const nodes = await j(await get(`/projects/${projectId}/nodes`));
    assert(nodes.length === f.nodeCount, 'assembly nodes persisted');
    assert(nodes.some((nd) => nd.modelId === f.modelId), 'nodes carry the linked model id');

    // Org-wide history + KPIs reflect the completion
    const monDone = await j(await get('/imports/monitor'));
    assert(monDone.kpis.completedTotal >= 1, 'monitor KPIs count the completed package');
    const histAll = await j(await get('/imports/history?limit=10'));
    const histRow = histAll.rows.find((r) => r.id === started.importFileId);
    assert(!!histRow && histRow.projectName === projRes.name && histRow.status === 'completed',
      'org-wide history lists the package with project name + final status');
    assert(typeof histAll.total === 'number' && histAll.total >= 1, 'history is paged with a total count');

    if (ioClient) {
      await sleep(300);
      assert(wsEvents.length >= 3, `live import:progress events received over the project room (${wsEvents.length})`);
      const mine = wsEvents.filter((e) => e.importFileId === started.importFileId);
      assert(mine.some((e) => e.stage === 'completed' && e.progress === 100), 'ws feed delivered the completed event');
      const seq = mine.map((e) => e.progress);
      assert(seq.every((p, i) => i === 0 || p >= seq[i - 1]), 'ws progress is non-decreasing');
      assert(strayEvents.length === 0, 'sockets that never joined the project room receive nothing (tenant-safe)');
    }
  }

  if (SCENARIO === 'failure' || SCENARIO === 'all') {
    // ── Failure path: invalid IFC fails in extraction, is retryable ─────
    const bad = Buffer.from('THIS IS NOT AN IFC FILE ' + 'x'.repeat(500));
    const upBad = await uploadIfc(projectId, 'broken.ifc', bad);
    const startedBad = await j(upBad);
    assert(!!startedBad.importFileId, 'invalid file is still stored + tracked (fails async, not at upload)');

    const { detail: dBad } = await followImport(projectId, startedBad.importFileId, 30_000);
    assert(dBad.file.status === 'failed', 'invalid IFC ends in failed status');
    assert(!!dBad.file.error && dBad.file.error.length > 0, `failure reason recorded ("${(dBad.file.error || '').slice(0, 60)}...")`);
    assert(dBad.events.some((e) => e.stage === 'failed'), 'timeline records the failure event');
    assert(dBad.file.nodeCount === 0, 'no nodes persisted from the broken file');

    // Retry restarts the pipeline from the stored source (and fails again).
    const rt = await post(`/projects/${projectId}/imports/${startedBad.importFileId}/retry`);
    assert(rt.status === 201 || rt.status === 200, 'retry accepted on a failed import');
    const { detail: dRetry } = await followImport(projectId, startedBad.importFileId, 30_000);
    assert(dRetry.file.status === 'failed', 'retried broken file fails again (deterministic)');
    assert(dRetry.events.some((e) => (e.detail || {}).retry === true || /retry/i.test(e.message)), 'timeline records the retry');

    // Retry guard: not allowed on non-failed imports
    const completedRow = (await j(await get(`/projects/${projectId}/imports`))).find((r) => r.status === 'completed');
    if (completedRow) {
      const rtBad = await post(`/projects/${projectId}/imports/${completedRow.id}/retry`);
      assert(rtBad.status === 400, 'retry rejected for completed imports (400)');
    }

    // History shows everything that ever happened in this project
    const hist = await j(await get(`/projects/${projectId}/imports`));
    assert(hist.some((r) => r.status === 'failed'), 'history keeps the failed upload');
    const histOrdered = hist.map((r) => new Date(r.createdAt).getTime());
    assert(histOrdered.every((t, i) => i === 0 || t <= histOrdered[i - 1]), 'history is newest-first');

    // Per-project scoping
    const projB = await j(await post('/projects', { name: `Import E2E B ${Date.now()}` }));
    const listB = await j(await get(`/projects/${projB.id}/imports`));
    assert(Array.isArray(listB) && listB.length === 0, "another project's monitoring history is empty (scoped)");
    const cross = await get(`/projects/${projB.id}/imports/${startedBad.importFileId}`);
    assert(cross.status === 404, 'import detail is not readable through a different project (404)');

    // Org-wide history honors the project filter
    const histB = await j(await get(`/imports/history?projects=${projB.id}`));
    assert(histB.rows.length === 0 && histB.total === 0, 'org history filtered to an empty project returns nothing');
    const histFail = await j(await get(`/imports/history?projects=${projectId}&sort=desc`));
    assert(histFail.rows.some((r) => r.id === startedBad.importFileId && r.status === 'failed'),
      'org history filtered to the project includes the failed package');
  }

  wsJoined?.close();
  wsStray?.close();
  console.log(`\n${n} assertions passed — import monitoring pipeline OK`);
  process.exit(0);
})().catch((e) => {
  console.error('SUITE ERROR:', e);
  process.exit(1);
});
