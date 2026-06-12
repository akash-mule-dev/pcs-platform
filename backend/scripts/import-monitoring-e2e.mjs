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

  if (SCENARIO === 'package' || SCENARIO === 'all') {
    // ── Multi-format: ZIP package (IFC + PDF drawings + KISS data) ────────
    // Probe a scratch project for real piece marks so the test PDFs can match.
    const probe = await j(await post('/projects', { name: `Pkg probe ${Date.now()}` }));
    const fdP = new FormData();
    fdP.append('file', new Blob([fs.readFileSync(IFC)]), 'probe.ifc');
    const started = await j(await fetch(`${A}/projects/${probe.id}/import-ifc`, { method: 'POST', headers: HA, body: fdP }));
    for (let t = 0; t < 80; t++) {
      const d = await j(await get(`/projects/${probe.id}/imports/${started.importFileId}`));
      if (d.file.status === 'completed' || d.file.status === 'failed') break;
      await sleep(400);
    }
    const probeNodes = await j(await get(`/projects/${probe.id}/nodes`));
    const marked = probeNodes.filter((nd) => nd.mark);
    const mark = marked[0]?.mark ?? null;

    const pkgProject = await j(await post('/projects', { name: `Pkg E2E ${Date.now()}` }));
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj <</Type/Catalog>> endobj\ntrailer <<>>\n%%EOF\n');
    const zip = makeStoreZip([
      { name: 'Project model.ifc', data: fs.readFileSync(IFC) },
      ...(mark ? [{ name: `Drawings/${mark} - Rev 0.pdf`, data: pdf }] : []),
      { name: 'Drawings/general-notes.pdf', data: pdf },
      { name: 'data/export.kss', data: Buffer.from('KISS test data') },
      { name: 'junk/readme.txt', data: Buffer.from('ignore me') },
    ]);
    const fdZ = new FormData();
    fdZ.append('file', new Blob([zip], { type: 'application/zip' }), 'coordination-package.zip');
    const zres = await fetch(`${A}/projects/${pkgProject.id}/import-ifc`, { method: 'POST', headers: HA, body: fdZ });
    const zstarted = await j(zres);
    assert(zres.status === 201 && !!zstarted.importFileId, 'ZIP package accepted by the import endpoint');

    let zfile = null;
    for (let t = 0; t < 100; t++) {
      const d = await j(await get(`/projects/${pkgProject.id}/imports/${zstarted.importFileId}`));
      zfile = d;
      if (d.file.status === 'completed' || d.file.status === 'failed') break;
      await sleep(400);
    }
    assert(zfile.file.status === 'completed', `package pipeline completes (${zfile.file.status})`);
    assert(zfile.file.nodeCount > 0, `assembly tree built from the IFC inside the package (${zfile.file.nodeCount} nodes)`);
    assert(!!zfile.file.modelId, '3D model converted from the package IFC');
    assert(zfile.events.some((e) => /Package unpacked/i.test(e.message)), 'timeline records the package classification');
    assert(zfile.events.some((e) => /Attached .* document/i.test(e.message)), 'timeline records the attached documents');

    const docs = await j(await get(`/projects/${pkgProject.id}/documents?importId=${zstarted.importFileId}`));
    const expectedDocs = (mark ? 3 : 2); // pdfs + kss; txt skipped
    assert(docs.length === expectedDocs, `package documents stored (${docs.length}), junk skipped`);
    if (mark) {
      const matchedDoc = docs.find((d) => d.node_mark === mark);
      assert(!!matchedDoc, `drawing "${mark} - Rev 0.pdf" auto-matched to piece mark ${mark}`);
    }
    assert(docs.some((d) => d.node_id === null), 'unmatched documents kept at project level');

    // Geometry-only format: a minimal OBJ converts to a GLB without a tree.
    const obj = Buffer.from('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n');
    const fdO = new FormData();
    fdO.append('file', new Blob([obj]), 'plate.obj');
    const ores = await j(await fetch(`${A}/projects/${pkgProject.id}/import-ifc`, { method: 'POST', headers: HA, body: fdO }));
    let ofile = null;
    for (let t = 0; t < 80; t++) {
      const d = await j(await get(`/projects/${pkgProject.id}/imports/${ores.importFileId}`));
      ofile = d.file;
      if (ofile.status === 'completed' || ofile.status === 'failed') break;
      await sleep(400);
    }
    assert(ofile.status === 'completed' && ofile.nodeCount === 0 && !!ofile.modelId,
      'geometry-only format (OBJ) converts to a 3D model without structure extraction');

    // Unsupported format rejected at upload time with a helpful message.
    const fdBad = new FormData();
    fdBad.append('file', new Blob([Buffer.from('nope')]), 'data.xyz');
    const bres = await fetch(`${A}/projects/${pkgProject.id}/import-ifc`, { method: 'POST', headers: HA, body: fdBad });
    assert(bres.status === 400, 'unsupported file format rejected with 400 + accepted-formats message');
  }

  wsJoined?.close();
  wsStray?.close();
  console.log(`\n${n} assertions passed — import monitoring pipeline OK`);
  process.exit(0);
})().catch((e) => {
  console.error('SUITE ERROR:', e);
  process.exit(1);
});

/** Minimal STORE-method ZIP writer (no deps) — enough for test fixtures. */
function makeStoreZip(entries) {
  const table = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  };
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);   // version needed
    local.writeUInt16LE(0, 6);    // flags
    local.writeUInt16LE(0, 8);    // method: store
    local.writeUInt32LE(0, 10);   // dos time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}
