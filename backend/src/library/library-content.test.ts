/**
 * Unit tests for the pure library copy logic.
 *   node --experimental-strip-types src/library/library-content.test.ts
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_LIBRARY_PROCESSES,
  DEFAULT_LIBRARY_TEMPLATES,
  processCopyFields,
  reconcileStagesBySequence,
  stageCopyFields,
  templateCopyFields,
} from './library-content.ts';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

console.log('library-content');

ok('default content is well-formed', () => {
  assert.ok(DEFAULT_LIBRARY_PROCESSES.length >= 1);
  const std = DEFAULT_LIBRARY_PROCESSES.find((p) => p.name === 'Standard Fabrication')!;
  assert.equal(std.stages.length, 5);
  const finalQc = std.stages.find((s) => s.isFinalQc);
  assert.ok(finalQc, 'a terminal final-QC release stage exists');
  // The default final-QC stage is a release gate (blocks on open NCRs / unsigned
  // failures) but NOT a hold point — it must not force a positive inspection.
  assert.ok(!finalQc!.requiresInspection && finalQc!.inspectionType !== 'hold', 'the default final-QC stage is not a hold point');
  assert.ok(DEFAULT_LIBRARY_TEMPLATES.some((t) => t.type === 'ncr'));
  assert.ok(DEFAULT_LIBRARY_TEMPLATES.some((t) => t.type === 'inspection'));
  for (const t of DEFAULT_LIBRARY_TEMPLATES) assert.ok(Array.isArray(t.schema.fields) && t.schema.fields.length);
});

ok('processCopyFields stamps target org + origin link', () => {
  const lib = { id: 'lib-1', name: 'Standard Fabrication', version: 2, organizationId: 'plat', libraryOriginId: null };
  const copy = processCopyFields(lib, 'tenant-9');
  assert.equal(copy.organizationId, 'tenant-9');
  assert.equal(copy.libraryOriginId, 'lib-1');
  assert.equal(copy.name, 'Standard Fabrication');
  assert.equal(copy.version, 2);
  assert.ok(!('id' in copy), 'never copies the source id');
});

ok('stageCopyFields rebinds process + org, preserves routing', () => {
  const s = { name: 'Welding', sequence: 3, targetTimeSeconds: 7200, description: 'd', requiresInspection: false };
  const c = stageCopyFields(s, 'proc-x', 'tenant-9');
  assert.equal(c.processId, 'proc-x');
  assert.equal(c.organizationId, 'tenant-9');
  assert.equal(c.sequence, 3);
  assert.equal(c.targetTimeSeconds, 7200);
});

ok('templateCopyFields deep-clones schema (no shared reference)', () => {
  const schema = { fields: [{ key: 'a' }] };
  const lib = { id: 't-1', name: 'NCR', type: 'ncr', schema, version: 1, organizationId: 'plat', libraryOriginId: null };
  const copy = templateCopyFields(lib, 'tenant-9');
  assert.equal(copy.libraryOriginId, 't-1');
  assert.equal(copy.organizationId, 'tenant-9');
  (copy.schema as any).fields[0].key = 'mutated';
  assert.equal(schema.fields[0].key, 'a', 'source schema must not be mutated');
});

ok('reconcileStagesBySequence: first publish inserts all', () => {
  const lib = [
    { name: 'Cut', sequence: 1, targetTimeSeconds: 60 },
    { name: 'Weld', sequence: 2, targetTimeSeconds: 120 },
  ];
  const { toInsert, toUpdate } = reconcileStagesBySequence(lib, new Map());
  assert.equal(toInsert.length, 2);
  assert.equal(toUpdate.length, 0);
});

ok('reconcileStagesBySequence: re-publish updates by sequence, inserts new, never deletes', () => {
  const lib = [
    { name: 'Cut', sequence: 1, targetTimeSeconds: 60 },
    { name: 'Weld', sequence: 2, targetTimeSeconds: 999 },
    { name: 'Paint', sequence: 3, targetTimeSeconds: 30 },
  ];
  const existing = new Map([[1, { id: 's1' }], [2, { id: 's2' }]]);
  const { toInsert, toUpdate } = reconcileStagesBySequence(lib, existing);
  assert.deepEqual(toInsert.map((s) => s.sequence), [3]);
  assert.deepEqual(toUpdate.map((u) => u.id), ['s1', 's2']);
  assert.equal(toUpdate.find((u) => u.id === 's2')!.fields.targetTimeSeconds, 999);
});

console.log(`${passed} assertion groups passed`);
