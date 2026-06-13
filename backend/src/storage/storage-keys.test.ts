/**
 * Pure unit tests for the blob key layout.
 * Run: node --experimental-strip-types src/storage/storage-keys.test.ts
 */
import assert from 'node:assert';
import { StorageKeys, orgOfKey } from './storage-keys.ts';

const ORG = '11111111-1111-1111-1111-111111111111';
let n = 0;
const ok = (label: string, cond: boolean) => { assert.ok(cond, label); n++; };

// Tenant partitioning: org is always the top-level segment.
ok('importSource is org-partitioned', StorageKeys.importSource(ORG, 'imp1', '.ifc') === `${ORG}/imports/imp1.ifc`);
ok('document is org-partitioned', StorageKeys.document(ORG, 'd1', 'pdf') === `${ORG}/documents/d1.pdf`);
ok('conversionSource is org-partitioned', StorageKeys.conversionSource(ORG, 'c1', '.step') === `${ORG}/conversions/c1.step`);
ok('model goes under models/', StorageKeys.model(ORG, 'm1') === `${ORG}/models/m1.glb`);
ok('thumbnail sits beside its model', StorageKeys.modelThumbnail(ORG, 'm1') === `${ORG}/models/m1/thumbnail.png`);
ok('quality evidence nests by entry', StorageKeys.qualityEvidence(ORG, 'e1', 'x', '.jpg') === `${ORG}/quality/evidence/e1/x.jpg`);
ok('ncr evidence nests by ncr', StorageKeys.ncrEvidence(ORG, 'ncr1', 'y', 'png') === `${ORG}/quality/ncr/ncr1/y.png`);
ok('coordination drawing', StorageKeys.coordinationDrawing(ORG, 'dr1') === `${ORG}/coordination/drawings/dr1.pdf`);
ok('media (future) is org+kind partitioned', StorageKeys.media(ORG, 'screenshots', 's1', '.png') === `${ORG}/media/screenshots/s1.png`);

// Extension normalization: dot optional, lowercased, empty when absent.
ok('ext gets a leading dot', StorageKeys.importSource(ORG, 'i', 'IFC') === `${ORG}/imports/i.ifc`);
ok('ext already dotted is kept', StorageKeys.importSource(ORG, 'i', '.ZIP') === `${ORG}/imports/i.zip`);
ok('no ext → no suffix', StorageKeys.importSource(ORG, 'i') === `${ORG}/imports/i`);

// No org → _shared (defensive; should be rare).
ok('missing org → _shared', StorageKeys.model(null, 'm') === `_shared/models/m.glb`);
ok('blank org → _shared', StorageKeys.model('   ', 'm') === `_shared/models/m.glb`);

// orgOfKey round-trips and tolerates legacy flat keys.
ok('orgOfKey extracts the tenant', orgOfKey(StorageKeys.model(ORG, 'm')) === ORG);
ok('orgOfKey on legacy flat key → null', orgOfKey('abc.glb') === null);
ok('orgOfKey on _shared → null', orgOfKey('_shared/models/m.glb') === null);

console.log(`✅ storage-keys: ${n} assertions passed`);
