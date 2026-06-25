/**
 * Unit tests for the pure revision-impact module.
 *   node --experimental-strip-types src/projects/revision-impact.test.ts
 */
import { revisionSeverity, summarizeImpact, bySeverity, SEVERITY_ORDER } from './revision-impact.ts';

let n = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`ok ${++n} - ${msg}`);
}

// ── revisionSeverity ──
assert(revisionSeverity(3, 5, 2) === 'critical', 'shipped qty > 0 is critical (overrides everything)');
assert(revisionSeverity(0, 4, 1) === 'high', 'no shipped but units done is high');
assert(revisionSeverity(0, 0, 2) === 'medium', 'work orders exist but nothing done is medium');
assert(revisionSeverity(0, 0, 0) === 'none', 'no production work is none');
assert(revisionSeverity(1, 0, 0) === 'critical', 'shipped with no recorded units still critical');

// ── summarizeImpact ──
const rows = [
  { severity: 'critical' as const },
  { severity: 'critical' as const },
  { severity: 'high' as const },
  { severity: 'medium' as const },
  { severity: 'none' as const },
];
const s = summarizeImpact(rows);
assert(s.pieces === 5, 'summary counts total pieces');
assert(s.critical === 2 && s.high === 1 && s.medium === 1 && s.none === 1, 'summary buckets each severity');
assert(summarizeImpact([]).pieces === 0, 'empty rows summarize to zero pieces');

// ── bySeverity sort ──
const sorted = [...rows].reverse().sort(bySeverity).map((r) => r.severity);
assert(sorted[0] === 'critical' && sorted[sorted.length - 1] === 'none', 'bySeverity sorts most urgent first');
assert(SEVERITY_ORDER.length === 4 && SEVERITY_ORDER[0] === 'critical', 'severity order is critical→none');

console.log(`\n${n} assertions passed - revision-impact`);
