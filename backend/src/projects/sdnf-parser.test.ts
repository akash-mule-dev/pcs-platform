/**
 * Unit tests for the SDNF parser.
 *   node --experimental-strip-types src/projects/sdnf-parser.test.ts
 */
import { parseSdnf, isSdnf, sdnfUnitToMm } from './sdnf-parser.ts';

let n = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`ok ${++n} - ${msg}`);
}
function approx(a: number | null, b: number, eps = 0.5): boolean {
  return a != null && Math.abs(a - b) <= eps;
}

// A realistic Intergraph SDNF 3.0 export in feet (coords x 304.8 -> mm).
const sdnf = [
  '# SDNF export from a detailing package',
  'Packet 00',
  'SDNF Version 3.0',
  '"Acme Engineering"',
  '"Client Co"',
  '"Frame A"',
  '"Project X"',
  '"06/29/26" "12:00"',
  '0 ""',
  '"AISC"',
  '0',
  'Packet 10',
  '"feet" 2',
  '1 8 0 1 "Beam" "B-101" 0',
  '"W12X50" "A36" 0.0 0 0',
  '0 0 1.0 0 0 10.0 20 0 10.0 0 0',
  '0 0',
  '0 0 0 0 0 0',
  '0 0 0 0 0 0 0 0 0 0 0 0',
  '2 8 0 1 "Column" "C-1" 0',
  '"W14X90" "A992" 90.0 0 0',
  '0 1.0 0 0 0 0 0 0 12.0 0 0',
  '0 0',
  '0 0 0 0 0 0',
  '0 0 0 0 0 0 0 0 0 0 0 0',
  'Packet 20',
  '"feet" "inch" 1',
  '100 1 0 1 "Gusset"',
  '"PL-1" "A36" 0.5 4',
  '0 0 0',
  '2 0 0',
  '2 1.5 0',
  '0 1.5 0',
].join('\n');

const m = parseSdnf(sdnf)!;
assert(!!m, 'sdnf parsed');
assert(m.version === '3.0', 'version 3.0 read from Packet 00');
assert(m.title.structure === 'Frame A', 'structure name read from Packet 00');
assert(m.title.project === 'Project X', 'project name read from Packet 00');
assert(m.units === 'feet', 'Packet 10 linear units read');
assert(m.members.length === 2, 'two linear members parsed');

const b = m.members[0];
assert(b.mark === 'B-101', 'member 1 mark from Rec1');
assert(b.type === 'Beam', 'member 1 type from Rec1');
assert(b.profile === 'W12X50', 'member 1 section size from Rec2');
assert(b.grade === 'A36', 'member 1 grade from Rec2');
assert(approx(b.lengthMm, 6096), 'member 1 length = 20ft = 6096mm (from Rec3 coords)');
assert(approx(b.start[2], 3048) && approx(b.end[0], 6096), 'member 1 coords converted ft->mm');

const c = m.members[1];
assert(c.mark === 'C-1', 'member 2 mark');
assert(c.profile === 'W14X90' && c.grade === 'A992', 'member 2 size + grade');
assert(approx(c.rotation, 90), 'member 2 rotation read from Rec2');
assert(approx(c.lengthMm, 3657.6), 'member 2 length = 12ft = 3657.6mm');

assert(m.plates.length === 1, 'one plate parsed');
const pl = m.plates[0];
assert(pl.mark === 'PL-1' && pl.grade === 'A36', 'plate mark + grade from Rec2');
assert(approx(pl.thicknessMm, 12.7), 'plate thickness 0.5in -> 12.7mm');
assert(pl.vertices.length === 4, 'plate outline has 4 vertices');
assert(approx(pl.lengthMm, 609.6) && approx(pl.widthMm, 457.2), 'plate bbox dims ft->mm');

// units helper + detection + negatives
assert(sdnfUnitToMm('feet') === 304.8, 'unit feet -> 304.8');
assert(sdnfUnitToMm('inch') === 25.4, 'unit inch -> 25.4');
assert(sdnfUnitToMm('mm') === 1 && sdnfUnitToMm('meters') === 1000, 'mm/meters scales');
assert(isSdnf(sdnf) === true, 'isSdnf true');
assert(isSdnf('ST\nB12\nEN') === false, 'isSdnf false for a DSTV file');
assert(parseSdnf('random text') === null, 'parseSdnf null for non-SDNF');

console.log(`\n${n} assertions passed - sdnf-parser`);
