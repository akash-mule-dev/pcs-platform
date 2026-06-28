/**
 * Unit tests for the KISS parser.
 *   node --experimental-strip-types src/projects/kiss-parser.test.ts
 */
import { parseKiss, isKiss } from './kiss-parser.ts';

let n = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`ok ${++n} - ${msg}`);
}

const kiss = [
  'KISS,1.1,PCS Test Writer',
  'H,JOB-42,Costco #123,Acme Steel,06/29/26,12:00:00,T,Final Bill',
  'A,Owner,Costco,1 Main St,Eugene,OR',
  'D,DWG-1,0,1001,1001,10,W,W 12x40,A992,6096.00,Galv,Beam',
  'L,Cuts,2,0,0',
  'D,DWG-1,0,1001,b1,40,L,L 3x3x1/4,A36,300.00,,Clip angle',
  'D,DWG-2,0,2001,2001,5,HSS,HSS 6x6x.250,A500,4000.00,,Column',
  'M,1001,10,Main Beam Assembly,BEAM,Floor beam,CC1',
  'M,2001,5,Column Assembly,COL,Column,CC2',
  '*,this is a comment line',
].join('\n');

const k = parseKiss(kiss)!;
assert(!!k, 'kiss parsed');
assert(k.version === '1.1', 'version read from KISS id line');
assert(k.job === 'JOB-42', 'job number read from H line');
assert(k.metric === true, 'metric flag T parsed');
assert(k.parts.length === 3, 'three detail parts parsed (L/A/*/M ignored)');

const p0 = k.parts[0];
assert(p0.assemblyMark === '1001' && p0.mark === '1001', 'part 0 assembly + part marks');
assert(p0.quantity === 10, 'part 0 quantity');
assert(p0.type === 'W' && p0.profile === 'W 12x40', 'part 0 type + profile (size)');
assert(p0.grade === 'A992', 'part 0 grade');
assert(p0.lengthMm === 6096, 'part 0 length is mm (6096.00)');

const p1 = k.parts[1];
assert(p1.mark === 'b1' && p1.quantity === 40, 'part 1 minor mark + qty (total, not per ship mark)');
assert(p1.profile === 'L 3x3x1/4' && p1.lengthMm === 300, 'part 1 angle profile + length');

const p2 = k.parts[2];
assert(p2.type === 'HSS' && p2.profile === 'HSS 6x6x.250', 'part 2 HSS tube profile');

assert(k.assemblies.length === 2, 'two assembly (M) lines parsed');
assert(k.assemblies[0].mark === '1001' && k.assemblies[0].quantity === 10, 'assembly 0 mark + qty');
assert(k.assemblies[0].name === 'Main Beam Assembly', 'assembly 0 name');

// detection + negatives
assert(isKiss(kiss) === true, 'isKiss true');
assert(isKiss('D,DWG-1,0,1001,1001,10,W') === false, 'isKiss false without KISS id line');
assert(parseKiss('ST\nB12\nEN') === null, 'parseKiss null for a DSTV file');

console.log(`\n${n} assertions passed - kiss-parser`);
