/**
 * Unit tests for the DSTV NC/NC1 parser.
 *   node --experimental-strip-types src/projects/dstv-nc-parser.test.ts
 */
import { parseDstvNc, isDstvNc, dstvNum } from './dstv-nc-parser.ts';

let n = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`ok ${++n} - ${msg}`);
}
function approx(a: number | null, b: number, eps = 0.01): boolean {
  return a != null && Math.abs(a - b) <= eps;
}

// A Tekla-style W-beam NC1 (imperial section, metric values, holes + contour)
const beam = [
  'ST', 'ORD-001', 'DWG-100', '1', 'B12', 'A992', '2', 'W12X26', 'I',
  '6096.00', '310.00', '165.00', '9.70', '6.40', '8.00', '38.69', '0.000',
  'BO',
  '  v 100.00u 45.00 22.00 0.00',
  '  v 300.00o 45.00 22.00 0.00',
  '  v 500.00u 45.00 22.00 0.00',
  'AK',
  '  v 0.00 0.00 0.00',
  '  v 6096.00 0.00 0.00',
  'EN',
].join('\n');

const p = parseDstvNc(beam)!;
assert(!!p, 'beam parsed');
assert(p.mark === 'B12', 'piece mark read from field 4');
assert(p.grade === 'A992', 'steel grade read from field 5');
assert(p.quantity === 2, 'quantity read from field 6');
assert(p.profile === 'W12X26', 'profile read from field 7');
assert(p.profileType === 'I', 'profile-type code read from field 8');
assert(approx(p.lengthMm, 6096), 'length mm read from field 9');
assert(approx(p.heightMm, 310), 'section height read from field 10');
assert(approx(p.widthMm, 165), 'flange width read from field 11');
assert(approx(p.flangeThicknessMm, 9.7), 'flange thickness read from field 12');
assert(approx(p.webThicknessMm, 6.4), 'web thickness read from field 13');
assert(approx(p.weightPerMetre, 38.69), 'weight per metre read from field 15');
assert(approx(p.weightKg!, 38.69 * 6.096, 0.5), 'per-piece weight = weight/m x length');
assert(p.holeCount === 3, 'three BO rows counted as holes');
assert(p.hasContour === true, 'AK contour detected');
assert(p.order === 'ORD-001' && p.drawing === 'DWG-100', 'order + drawing read');

// European decimal comma + plate (B) profile, no holes
const plate = [
  'ST', '-', '-', '-', 'PL5', 'S355JR', '4', 'FL200*10', 'B',
  '1250,50', '200,00', '10,00', '10,00', '10,00', '0,00', '15,70',
  'EN',
].join('\n');
const pl = parseDstvNc(plate)!;
assert(pl.mark === 'PL5', 'plate mark read');
assert(pl.grade === 'S355JR', 'plate grade read');
assert(pl.profileType === 'B', 'plate profile-type B');
assert(approx(pl.lengthMm, 1250.5), 'comma-decimal length parsed 1250,50');
assert(approx(pl.heightMm, 200), 'comma-decimal height parsed 200,00');
assert(approx(pl.widthMm, 10), 'comma-decimal width parsed 10,00');
assert(pl.holeCount === 0 && pl.hasContour === false, 'no holes / contour on bare plate');
assert(pl.order === null && pl.drawing === null, 'empty dash text fields become null');

// fallback mark from filename when the header omits one
const noMark = [
  'ST', '-', '-', '-', '-', 'S275', '1', 'HEA200', 'I',
  '3000.00', '190.00', '200.00', '10.00', '6.50', '18.00', '42.30',
  'EN',
].join('\n');
const nm = parseDstvNc(noMark, 'A-101')!;
assert(nm.mark === 'A-101', 'falls back to filename stem when mark field empty');

// detection + numeric helper + negative cases
assert(isDstvNc(beam) === true, 'isDstvNc true for an ST file');
assert(isDstvNc('solid CAD\nnonsense') === false, 'isDstvNc false for non-DSTV text');
assert(parseDstvNc('not a dstv file') === null, 'parseDstvNc returns null for junk');
assert(dstvNum('1.234,56') === 1234.56, 'dstvNum handles EU thousands+decimal');
assert(dstvNum('42.5 mm') === 42.5, 'dstvNum ignores trailing unit text');
assert(dstvNum('') === null && dstvNum(undefined) === null, 'dstvNum null-safe');

console.log(`\n${n} assertions passed - dstv-nc-parser`);
