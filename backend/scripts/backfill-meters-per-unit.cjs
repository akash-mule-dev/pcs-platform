/*
 * One-off, idempotent backfill of models.meters_per_unit (the 1:1 AR scale —
 * metres-per-GLB-unit). New imports stamp this automatically; this fills in models
 * imported before the feature existed so they too load at TRUE 1:1.
 *
 * Determined by the CONVERSION PIPELINE's output unit (see conversion/meters-per-unit.ts):
 *   - IFC → 1000.  web-ifc emits metres AND optimize-glb re-applies mm→0.001, so the
 *           stored GLB is 1000× too small; scale 1000 restores real size.
 *   - everything else → 1.0  (STEP/CAD from OCCT-mm → optimizer → metres; raw glTF
 *           already metres; mesh treated as metres).
 * Keyed off the import/model FORMAT (the converted output is always .glb).
 *
 * Idempotent: only touches rows where meters_per_unit IS NULL or wrong (FORCE=1 to
 * re-set every row — use after correcting the formula). DRY-RUN by default; APPLY=1 writes.
 *
 * Run (from backend/):
 *   DATABASE_URL='...' node scripts/backfill-meters-per-unit.cjs              # dry-run
 *   DATABASE_URL='...' APPLY=1 FORCE=1 node scripts/backfill-meters-per-unit.cjs  # re-set all
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const APPLY = process.env.APPLY === '1';
const FORCE = process.env.FORCE === '1';
const DB_URL =
  process.env.DATABASE_URL ||
  (fs.existsSync(path.join(__dirname, '../.env')) &&
    fs.readFileSync(path.join(__dirname, '../.env'), 'utf8').match(/DATABASE_URL=(.*)/)?.[1]?.trim().replace(/^"|"$/g, ''));

// Mirror of conversion/meters-per-unit.ts: IFC GLBs are baked 1000× small; all else 1.0.
// ZIP coordination packages (Tekla/SDS2) carry IFC inside → their GLB is web-ifc-derived,
// so same 1000× compensation. (A non-IFC ZIP is rare for steel; 1000 is the safe default.)
function metersPerUnitForFormat(fmt) {
  const f = (fmt || '').toLowerCase();
  return f === 'ifc' || f === 'zip' ? 1000 : 1;
}

(async () => {
  if (!DB_URL) { console.error('No DATABASE_URL'); process.exit(1); }
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Ensure the column exists (matches Model3D entity; TypeORM synchronize adds it on
  // boot too — this makes the backfill self-contained if run before a boot). Idempotent.
  await c.query('ALTER TABLE models ADD COLUMN IF NOT EXISTS meters_per_unit numeric(12,6)');

  const where = FORCE ? '' : 'WHERE m.meters_per_unit IS NULL';
  const { rows } = await c.query(`
    SELECT m.id, m.name, m.file_format, m.meters_per_unit,
           i.format AS import_format
    FROM models m
    LEFT JOIN import_files i ON i.model_id = m.id
    ${where}
    ORDER BY m.created_at DESC`);

  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${rows.length} model(s)${FORCE ? ' (FORCE: all rows)' : ' (meters_per_unit IS NULL)'}\n`);

  let set = 0, byFmt = {};
  for (const r of rows) {
    const fmt = (r.import_format || r.file_format || '').toLowerCase();
    const mpu = metersPerUnitForFormat(fmt);
    byFmt[fmt || '(none)'] = (byFmt[fmt || '(none)'] || 0) + 1;
    set++;
    console.log(`  ✓ SET   ${r.name}  [${fmt || '?'}] → ${mpu} m/unit${r.meters_per_unit != null ? `  (was ${r.meters_per_unit})` : ''}`);
    if (APPLY) await c.query('UPDATE models SET meters_per_unit = $1 WHERE id = $2', [mpu, r.id]);
  }

  console.log(`\nSummary: ${set} set. By format:`, byFmt);
  console.log(APPLY ? '✅ Written.' : 'ℹ️  Dry-run only — set APPLY=1 to write.');
  await c.end();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
