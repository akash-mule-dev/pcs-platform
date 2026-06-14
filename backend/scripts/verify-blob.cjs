/* One-off: prove the Vercel Blob provider round-trips against the real store.
   Run: PCS_DEV_BLOB_READ_WRITE_TOKEN=... node scripts/verify-blob.cjs */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.BLOB_MULTIPART_THRESHOLD = String(1 * 1024 * 1024); // 1MB → 2MB file goes multipart
const { VercelBlobStorageProvider } = require('../dist/storage/providers/vercel-blob-storage.provider.js');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const tmp = (name) => path.join(os.tmpdir(), `pcs-blob-verify-${crypto.randomUUID()}-${name}`);
async function drain(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}
let pass = 0, fail = 0;
const ok = (label, cond) => { cond ? (pass++, console.log(`  ✓ ${label}`)) : (fail++, console.error(`  ✗ ${label}`)); };

(async () => {
  const provider = new VercelBlobStorageProvider();
  const run = crypto.randomUUID().slice(0, 8);
  const smallKey = `import-sources/verify-${run}-small.txt`;
  const largeKey = `import-sources/verify-${run}-large.bin`;

  // 1. Small file → single PUT (buffer path)
  console.log('\n[1] Small file (buffer path)');
  const smallBuf = Buffer.from(`hello vercel blob ${run}\n`.repeat(50));
  const sp = tmp('small.txt');
  fs.writeFileSync(sp, smallBuf);
  const retKey = await provider.upload(sp, smallKey, 'text/plain');
  ok('upload returns the SAME key (pathname contract)', retKey === smallKey);
  ok('temp file cleaned up after upload', !fs.existsSync(sp));
  const back = await drain(await provider.download(smallKey));
  ok('download bytes match upload', sha(back) === sha(smallBuf));
  ok('exists() === true', (await provider.exists(smallKey)) === true);
  const url = await provider.getUrl(smallKey);
  ok('getUrl() returns a vercel-storage URL', !!url && /^https:\/\/.+vercel-storage\.com\//.test(url));
  ok('URL pathname matches the key', !!url && new URL(url).pathname === `/${smallKey}`);

  // 1b. uploadBuffer → memory straight to Blob (no local temp file)
  console.log('\n[1b] uploadBuffer (memory → Blob, no disk)');
  const bufKey = `import-sources/verify-${run}-buf.bin`;
  const memBuf = crypto.randomBytes(64 * 1024);
  const retBufKey = await provider.uploadBuffer(memBuf, bufKey, 'application/octet-stream');
  ok('uploadBuffer returns the key', retBufKey === bufKey);
  const bufBack = await drain(await provider.download(bufKey));
  ok('uploadBuffer round-trip byte-identical', sha(bufBack) === sha(memBuf));
  await provider.delete(bufKey);

  // 2. Large file → streamed multipart upload
  console.log('\n[2] Large file (streamed multipart, threshold=1MB)');
  const largeBuf = crypto.randomBytes(2 * 1024 * 1024); // 2MB
  const lp = tmp('large.bin');
  fs.writeFileSync(lp, largeBuf);
  await provider.upload(lp, largeKey, 'application/octet-stream');
  const lback = await drain(await provider.download(largeKey));
  ok('2MB multipart round-trip byte-identical', sha(lback) === sha(largeBuf));

  // 3. Cold resolution: a brand-new instance has no cache/origin, so download
  //    must rediscover the URL via head/list (the post-restart path).
  console.log('\n[3] Cold key→URL resolution (fresh instance)');
  const cold = new VercelBlobStorageProvider();
  const coldBack = await drain(await cold.download(smallKey));
  ok('cold download (head/list) bytes match', sha(coldBack) === sha(smallBuf));
  ok('cold exists() === true', (await cold.exists(smallKey)) === true);

  // 4. Delete + confirm gone
  console.log('\n[4] Delete');
  await provider.delete(smallKey);
  await provider.delete(largeKey);
  ok('exists() === false after delete', (await provider.exists(smallKey)) === false);
  // (download right after delete can transiently hit CDN cache for private blobs;
  //  the real not-found contract is a never-written key.)
  ok('exists() === false for a never-written key', (await provider.exists(`import-sources/never-${run}.txt`)) === false);
  ok('download of a never-written key rejects', await provider.download(`import-sources/never-${run}.txt`).then(() => false, () => true));

  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
