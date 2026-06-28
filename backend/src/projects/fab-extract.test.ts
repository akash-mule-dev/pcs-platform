/**
 * Unit tests for the fab-format -> assembly-tree + solids mapping.
 *   node --experimental-strip-types src/projects/fab-extract.test.ts
 */
import {
  dstvToExtract, sdnfToExtract, kissToExtract,
  dstvShape, kissShape, shapeFromDesignation, nominalSectionMm,
} from './fab-extract.ts';
import type { DstvPart } from './dstv-nc-parser.ts';
import type { SdnfModel } from './sdnf-parser.ts';
import type { KissModel } from './kiss-parser.ts';

let n = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`ok ${++n} - ${msg}`);
}
const approx = (a: number | null, b: number, e = 1) => a != null && Math.abs(a - b) <= e;

// ── DSTV mapping ──
const dstvPart = (over: Partial<DstvPart>): DstvPart => ({
  order: null, drawing: null, phase: null, mark: null, grade: null, quantity: 1,
  profile: null, profileType: null, lengthMm: null, heightMm: null, widthMm: null,
  flangeThicknessMm: null, webThicknessMm: null, radiusMm: null, weightPerMetre: null,
  weightKg: null, holeCount: 0, hasContour: false, ...over,
});
const dstv = dstvToExtract([
  dstvPart({ mark: 'B1', profile: 'W12X26', profileType: 'I', grade: 'A992', quantity: 2, lengthMm: 6096, heightMm: 310, widthMm: 165, webThicknessMm: 6.4, flangeThicknessMm: 9.7, weightKg: 235.9 }),
  dstvPart({ mark: 'PL1', profile: 'FL200*10', profileType: 'B', grade: 'S355', quantity: 4, lengthMm: 1250, heightMm: 200, widthMm: 10 }),
], 'My Job');
assert(dstv.result.format === 'dstv', 'dstv result format');
assert(dstv.result.nodes[0].type === 'group' && dstv.result.nodes[0].externalId === 'dstv-root', 'root group node');
assert(dstv.result.counts.group === 1 && dstv.result.counts.part === 2, 'counts: 1 group, 2 parts');
const b1 = dstv.result.nodes.find((x) => x.mark === 'B1')!;
assert(b1.parentExternalId === 'dstv-root' && b1.type === 'part', 'B1 is a part under root');
assert(b1.profile === 'W12X26' && b1.materialGrade === 'A992' && approx(b1.lengthMm, 6096), 'B1 fab attributes mapped');
assert(b1.meshName === b1.externalId, 'meshName equals externalId (viewer join key)');
assert(dstv.solids.length === 2 && dstv.solids[0].shape === 'I', 'two solids; B1 is an I-section');
assert(dstv.solids[1].shape === 'B', 'plate solid shape B');
assert(dstv.solids[0].start![1] !== dstv.solids[1].start![1], 'parts laid out on different rows (no overlap)');

// ── SDNF mapping ──
const sdnfModel: SdnfModel = {
  version: '3.0', title: { firm: 'F', client: 'C', structure: 'Frame A', project: 'P' }, units: 'feet',
  members: [{ id: '1', type: 'Beam', mark: 'B-101', revision: '0', profile: 'W12X50', grade: 'A36', rotation: 0, start: [0, 0, 3048], end: [6096, 0, 3048], orientation: [0, 0, 1], lengthMm: 6096 }],
  plates: [{ id: '100', type: 'Gusset', mark: 'PL-1', grade: 'A36', thicknessMm: 12.7, vertices: [[0, 0, 0], [600, 0, 0], [600, 450, 0], [0, 450, 0]], lengthMm: 600, widthMm: 450 }],
};
const sdnf = sdnfToExtract(sdnfModel, 'fallback');
assert(sdnf.result.nodes[0].name === 'Frame A', 'SDNF root uses structure name');
assert(sdnf.result.counts.part === 2, 'member + plate = 2 parts');
const mem = sdnf.result.nodes.find((x) => x.mark === 'B-101')!;
assert(mem.profile === 'W12X50' && approx(mem.lengthMm, 6096), 'member profile + length');
const memSolid = sdnf.solids.find((s) => s.meshName === mem.externalId)!;
assert(memSolid.shape === 'I' && memSolid.start![2] === 3048 && memSolid.end![0] === 6096, 'member solid uses real coords');
const plateSolid = sdnf.solids.find((s) => s.polygon)!;
assert(!!plateSolid && plateSolid.polygon!.vertices.length === 4, 'plate becomes an extruded polygon solid');

// ── KISS mapping ──
const kissModel: KissModel = {
  version: '1.1', job: 'J', jobName: 'Costco', metric: true,
  parts: [
    { drawingNo: 'D1', assemblyMark: '1001', mark: '1001', quantity: 10, type: 'W', profile: 'W 12x40', grade: 'A992', lengthMm: 6096, finish: null, notes: null },
    { drawingNo: 'D1', assemblyMark: '1001', mark: 'b1', quantity: 40, type: 'L', profile: 'L 3x3x1/4', grade: 'A36', lengthMm: 300, finish: null, notes: null },
  ],
  assemblies: [{ mark: '1001', quantity: 10, name: 'Beam Assembly' }],
};
const kiss = kissToExtract(kissModel, 'fallback');
assert(kiss.result.counts.assembly === 1 && kiss.result.counts.part === 2, 'KISS: 1 assembly, 2 parts');
const asm = kiss.result.nodes.find((x) => x.type === 'assembly')!;
assert(asm.mark === '1001' && asm.name === 'Beam Assembly' && asm.quantity === 10, 'assembly node from M line');
const minor = kiss.result.nodes.find((x) => x.mark === 'b1')!;
assert(minor.parentExternalId === asm.externalId && minor.depth === 2, 'minor part nests under its assembly (depth 2)');
assert(kiss.solids.find((s) => s.meshName === minor.externalId)!.shape === 'L', 'angle minor part is an L solid');

// ── shape + nominal helpers ──
assert(dstvShape('U') === 'U' && dstvShape('SO') === 'box', 'dstvShape maps U + SO');
assert(kissShape('HSS') === 'M' && kissShape('PI') === 'RO', 'kissShape maps HSS + PI');
assert(shapeFromDesignation('W12X50') === 'I' && shapeFromDesignation('L4X4') === 'L', 'shapeFromDesignation W + L');
assert(approx(nominalSectionMm('W12X50'), 304.8, 1) , 'nominal W12 ~ 12in = 304.8mm');
assert(approx(nominalSectionMm('W310X90'), 310, 1), 'nominal W310 ~ 310mm (already metric)');

console.log(`\n${n} assertions passed - fab-extract`);
