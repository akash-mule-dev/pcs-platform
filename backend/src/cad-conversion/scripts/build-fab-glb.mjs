/**
 * Synthesize a GLB from parsed steel-fabrication solids (DSTV / SDNF / KISS).
 *
 * These formats have no triangle geometry of their own, but they DO carry
 * enough to reconstruct recognizable shapes: DSTV gives exact section
 * dimensions, SDNF gives global member end-points + plate outlines, KISS gives
 * section designations. This script turns a normalized "solids" list into a
 * single GLB with ONE node per part, named by the part's stable key (which
 * equals assembly_nodes.ifc_guid / mesh_name) so the existing three-viewer can
 * highlight / colour each part exactly like the IFC and STEP paths.
 *
 * Geometry is approximate-but-faithful: rolled sections are built from their
 * profile family (I/U/L/T/M/RO/RU/B) as a union of box / cylinder primitives,
 * extruded along the member axis and oriented from start->end (+ an optional
 * up/orientation vector). Plates are extruded polygons. All lengths are mm.
 *
 * Usage: node build-fab-glb.mjs <solids.json> <output.glb>
 *   solids.json = { "solids": [ { meshName, shape, dims, start, end, up?,
 *                                  polygon? } ] }
 */
import * as fs from 'fs';
import { buildGLB } from './glb-build.mjs';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: build-fab-glb.mjs <solids.json> <output.glb>');
  process.exit(1);
}

const num = (v, d = 0) => (Number.isFinite(v) && v > 0 ? v : d);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const L = len(a) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };

/** Orthonormal basis with local +X along start->end and +Z along `up`. */
function basis(start, end, up) {
  let x = sub(end, start);
  if (len(x) < 1e-9) x = [1, 0, 0];
  x = norm(x);
  let u = up && len(up) > 1e-9 ? up : [0, 0, 1];
  let z = sub(u, scale(x, dot(u, x)));
  if (len(z) < 1e-6) { u = Math.abs(x[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1]; z = sub(u, scale(x, dot(u, x))); }
  z = norm(z);
  const y = norm(cross(z, x));
  return { x, y, z };
}
const toWorld = (start, R, lx, ly, lz) => [
  start[0] + R.x[0] * lx + R.y[0] * ly + R.z[0] * lz,
  start[1] + R.x[1] * lx + R.y[1] * ly + R.z[1] * lz,
  start[2] + R.x[2] * lx + R.y[2] * ly + R.z[2] * lz,
];

/** Cross-section rectangles {cy,cz,sy,sz} (local Y-Z) for a profile family. */
function sectionBoxes(shape, d) {
  const h = num(d.h, 100), b = num(d.b, 100);
  const tw = num(d.tw, Math.max(4, h * 0.05));
  const tf = num(d.tf, Math.max(5, h * 0.08));
  const t = num(d.t, num(d.tw, 10));
  switch ((shape || 'box').toUpperCase()) {
    case 'I':
      return [
        { cy: 0, cz: 0, sy: tw, sz: Math.max(1, h - 2 * tf) },
        { cy: 0, cz: (h - tf) / 2, sy: b, sz: tf },
        { cy: 0, cz: -(h - tf) / 2, sy: b, sz: tf },
      ];
    case 'U':
    case 'C':
      return [
        { cy: -(b - tw) / 2, cz: 0, sy: tw, sz: h },
        { cy: 0, cz: (h - tf) / 2, sy: b, sz: tf },
        { cy: 0, cz: -(h - tf) / 2, sy: b, sz: tf },
      ];
    case 'L':
      return [
        { cy: -(b / 2) + t / 2, cz: 0, sy: t, sz: h },
        { cy: 0, cz: -(h / 2) + t / 2, sy: b, sz: t },
      ];
    case 'T':
      return [
        { cy: 0, cz: (h - tf) / 2, sy: b, sz: tf },
        { cy: 0, cz: -tf / 2, sy: tw, sz: Math.max(1, h - tf) },
      ];
    case 'M': // rectangular hollow section -> solid box (viz)
      return [{ cy: 0, cz: 0, sy: b, sz: h }];
    case 'B': // plate: width b x thickness t
      return [{ cy: 0, cz: 0, sy: Math.max(b, h), sz: Math.max(1, num(d.t, Math.min(b, h) || 10)) }];
    default:
      return [{ cy: 0, cz: 0, sy: b, sz: h }];
  }
}

/** Append a transformed box (local-frame, extruded full length along X). */
function addBox(verts, indices, start, R, length, cy, cz, sy, sz) {
  const base = verts.length / 3;
  const xs = [0, length];
  const ys = [cy - sy / 2, cy + sy / 2];
  const zs = [cz - sz / 2, cz + sz / 2];
  for (const x of xs) for (const y of ys) for (const z of zs) {
    const w = toWorld(start, R, x, y, z);
    verts.push(w[0], w[1], w[2]);
  }
  // 8 corners indexed by (xi*4 + yi*2 + zi); 6 quad faces -> 12 triangles.
  const q = (a, b, c, d) => indices.push(base + a, base + b, base + c, base + a, base + c, base + d);
  q(0, 1, 3, 2); // x=0
  q(4, 6, 7, 5); // x=1
  q(0, 4, 5, 1); // z=0
  q(2, 3, 7, 6); // z=1
  q(0, 2, 6, 4); // y=0
  q(1, 5, 7, 3); // y=1
}

/** Append a transformed N-gon prism (round bar / tube), diameter d.h. */
function addCylinder(verts, indices, start, R, length, diameter, seg = 16) {
  const r = Math.max(1, diameter / 2);
  const base = verts.length / 3;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const cy = Math.cos(a) * r, cz = Math.sin(a) * r;
    let w = toWorld(start, R, 0, cy, cz); verts.push(w[0], w[1], w[2]);
    w = toWorld(start, R, length, cy, cz); verts.push(w[0], w[1], w[2]);
  }
  for (let i = 0; i < seg; i++) {
    const a0 = base + i * 2, a1 = base + ((i + 1) % seg) * 2;
    indices.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1); // side wall
  }
  // caps (triangle fans)
  const c0 = verts.length / 3; let w = toWorld(start, R, 0, 0, 0); verts.push(w[0], w[1], w[2]);
  const c1 = verts.length / 3; w = toWorld(start, R, length, 0, 0); verts.push(w[0], w[1], w[2]);
  for (let i = 0; i < seg; i++) {
    const a0 = base + i * 2, a1 = base + ((i + 1) % seg) * 2;
    indices.push(c0, a1, a0);
    indices.push(c1, a0 + 1, a1 + 1);
  }
}

/** Append an extruded polygon plate (vertices in world mm, normal-extruded). */
function addPolygon(verts, indices, poly, thickness) {
  const pts = poly.map((p) => [p[0], p[1], p[2]]);
  if (pts.length < 3) return;
  // Plane normal from the first non-degenerate triangle.
  let nrm = [0, 0, 1];
  for (let i = 2; i < pts.length; i++) {
    const c = cross(sub(pts[1], pts[0]), sub(pts[i], pts[0]));
    if (len(c) > 1e-6) { nrm = norm(c); break; }
  }
  const half = Math.max(0.5, thickness / 2);
  const off = scale(nrm, half);
  const base = verts.length / 3;
  for (const p of pts) verts.push(p[0] + off[0], p[1] + off[1], p[2] + off[2]); // top ring
  for (const p of pts) verts.push(p[0] - off[0], p[1] - off[1], p[2] - off[2]); // bottom ring
  const N = pts.length;
  for (let i = 1; i < N - 1; i++) {
    indices.push(base, base + i, base + i + 1);                 // top face fan
    indices.push(base + N, base + N + i + 1, base + N + i);     // bottom face fan
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    indices.push(base + i, base + N + i, base + j);
    indices.push(base + j, base + N + i, base + N + j);
  }
}

function buildMesh(solid) {
  const verts = [];
  const indices = [];
  if (solid.polygon && Array.isArray(solid.polygon.vertices)) {
    addPolygon(verts, indices, solid.polygon.vertices, num(solid.polygon.thickness, 10));
  } else {
    const start = solid.start || [0, 0, 0];
    const end = solid.end || [num(solid.lengthMm, 1000), 0, 0];
    const R = basis(start, end, solid.up);
    const length = Math.max(1, len(sub(end, start)));
    const shape = (solid.shape || 'box').toUpperCase();
    const d = solid.dims || {};
    if (shape === 'RO' || shape === 'RU') {
      addCylinder(verts, indices, start, R, length, num(d.d, num(d.h, 50)));
    } else {
      for (const box of sectionBoxes(shape, d)) addBox(verts, indices, start, R, length, box.cy, box.cz, box.sy, box.sz);
    }
  }
  return { name: solid.meshName || 'part', vertices: verts, indices };
}

const spec = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const solids = Array.isArray(spec.solids) ? spec.solids : [];
const meshes = solids.map(buildMesh).filter((m) => m.vertices.length && m.indices.length);
if (!meshes.length) {
  console.error('No solids to build into a GLB');
  process.exit(2);
}
const glb = buildGLB(meshes);
fs.writeFileSync(outputPath, glb);
console.log(`Built GLB with ${meshes.length} part node(s), ${glb.length} bytes`);
