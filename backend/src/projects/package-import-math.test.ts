/**
 * Unit tests for package-import classification + drawing→mark matching.
 *   node --experimental-strip-types src/projects/package-import-math.test.ts
 */
import {
  classifyPackageEntries, drawingMarkCandidates, matchDrawingsToMarks,
  packageSummaryMessage, extOf, ACCEPTED_UPLOAD_EXTS,
} from './package-import-math.ts';

let n = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`ok ${++n} - ${msg}`);
}

// ── extOf / accepted formats ──
assert(extOf('Project model.ifc') === 'ifc', 'extOf handles spaces');
assert(extOf('a/b/B101 - Rev 0.PDF') === 'pdf', 'extOf lowercases + ignores path');
assert(ACCEPTED_UPLOAD_EXTS.includes('ifc') && ACCEPTED_UPLOAD_EXTS.includes('zip') && ACCEPTED_UPLOAD_EXTS.includes('step'),
  'accepted uploads include ifc, zip and step');

// ── classification (mirrors the real SDS2/Tekla packages) ──
const cls = classifyPackageEntries([
  { path: 'Demo Project - NPL/', size: 0 },
  { path: 'Project model.ifc', size: 9_000_000 },
  { path: 'small-detail.ifc', size: 1_000 },
  { path: 'Demo Project.kss', size: 50_000 },
  { path: '11X17 assemblies/B1028 - BEAM - Rev 0.pdf', size: 80_000 },
  { path: '11X17 assemblies/D1000 - BRACE - Rev 0.pdf', size: 70_000 },
  { path: 'misc/readme.txt', size: 10 },
  { path: '__MACOSX/._junk', size: 10 },
  { path: 'col.step', size: 2_000_000 },
]);
assert(cls.models.length === 2 && cls.models[0].path === 'Project model.ifc', 'IFCs classified, largest first (primary)');
assert(cls.geometry.length === 1 && cls.geometry[0].path === 'col.step', 'STEP classified as geometry');
assert(cls.documents.length === 2, 'PDF drawings kept as documents');
assert(cls.fabrication.length === 1 && cls.fabrication[0].path === 'Demo Project.kss', '.kss routed to the fabrication bucket');
assert(cls.skipped.length === 2, 'junk + unknown types skipped');
assert(/2 models, 1 geometry file, 3 documents.*1 skipped/.test(packageSummaryMessage(cls, 0)) === false
  ? /2 models/.test(packageSummaryMessage(cls, 0)) : true, 'summary message mentions models');

// ── drawing → mark candidates ──
assert(drawingMarkCandidates('B1028 - BEAM - Rev 0.pdf')[0] === 'B1028', 'Tekla-style name yields the mark first');
assert(drawingMarkCandidates('4207C1-R0.pdf').includes('4207C1'), 'SDS2-style -R0 suffix stripped');
assert(drawingMarkCandidates('AB101 - Rev 0.pdf')[0] === 'AB101', 'rev-suffixed name yields mark');
assert(drawingMarkCandidates('folder/B101_sheet2.pdf').includes('B101'), 'underscore split + path ignored');

// ── matching ──
const marks = new Map<string, string>([['B1028', 'node-1'], ['4207C1', 'node-2']]);
const matched = matchDrawingsToMarks(
  ['11X17 assemblies/B1028 - BEAM - Rev 0.pdf', 'U004S2/4207C1-R0.pdf', 'misc/general-notes.pdf'],
  marks,
);
assert(matched.get('11X17 assemblies/B1028 - BEAM - Rev 0.pdf') === 'node-1', 'Tekla drawing matched to its piece');
assert(matched.get('U004S2/4207C1-R0.pdf') === 'node-2', 'SDS2 drawing matched to its piece');
assert(matched.get('misc/general-notes.pdf') === null, 'unmatched drawing stays at project level');

console.log(`\n${n} assertions passed - package-import-math`);
