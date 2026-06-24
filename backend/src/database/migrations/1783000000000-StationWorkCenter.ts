import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Work-center (station) upgrade — turns the bare station record into a managed
 * work-center for the /stations cockpit:
 *
 *  - stations.code / description            — identity for the directory
 *  - stations.type (enum)                   — laser/saw/drill/fit_up/weld/blast/paint/qc/other
 *  - stations.status (enum)                 — operational state set via stations.operate
 *  - stations.available_hours_per_day       — capacity basis (utilization denominator)
 *  - stations.updated_at                    — audit of edits/status flips
 *  - lines: replace the GLOBAL unique on name with a PER-ORG unique
 *    (the old column-level unique caused a raw 500 when two tenants reused a
 *    line name). Named UQ_lines_org_name so this migration and `synchronize`
 *    agree on the index.
 *
 * Additive + idempotent + guarded: safe to re-run and safe to run after
 * `synchronize` has already applied the same shape (DB_SYNCHRONIZE defaults on).
 * stations already carries organization_id, so it is already covered by the
 * generic TenantRls policy — no extra RLS enrollment needed here.
 */
export class StationWorkCenter1783000000000 implements MigrationInterface {
  name = 'StationWorkCenter1783000000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── enum types (guarded) ─────────────────────────────────────────────────
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stations_type_enum') THEN
          CREATE TYPE "stations_type_enum" AS ENUM ('laser','saw','drill','fit_up','weld','blast','paint','qc','other');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stations_status_enum') THEN
          CREATE TYPE "stations_status_enum" AS ENUM ('available','running','idle','setup','down','maintenance','offline');
        END IF;
      END $$;
    `);

    // ── station columns (guarded, additive) ──────────────────────────────────
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stations') THEN
          ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "code" varchar(100) NULL;
          ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "description" text NULL;
          ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "type" "stations_type_enum" NOT NULL DEFAULT 'other';
          ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "status" "stations_status_enum" NOT NULL DEFAULT 'available';
          ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "available_hours_per_day" numeric(6,2) NULL;
          ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();
        END IF;
      END $$;
    `);

    // ── lines: global unique(name) → per-org unique(organization_id, name) ────
    await q.query(`
      DO $$
      DECLARE c text;
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lines') THEN
          FOR c IN
            SELECT conname FROM pg_constraint
             WHERE conrelid = 'lines'::regclass AND contype = 'u'
               AND array_length(conkey, 1) = 1
               AND (SELECT attname FROM pg_attribute
                     WHERE attrelid = 'lines'::regclass AND attnum = conkey[1]) = 'name'
          LOOP
            EXECUTE format('ALTER TABLE "lines" DROP CONSTRAINT %I', c);
          END LOOP;
        END IF;
      END $$;
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lines_org_name" ON "lines" ("organization_id", "name")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_lines_org_name"`);
    await q.query(`ALTER TABLE IF EXISTS "stations" DROP COLUMN IF EXISTS "available_hours_per_day"`);
    await q.query(`ALTER TABLE IF EXISTS "stations" DROP COLUMN IF EXISTS "updated_at"`);
    await q.query(`ALTER TABLE IF EXISTS "stations" DROP COLUMN IF EXISTS "status"`);
    await q.query(`ALTER TABLE IF EXISTS "stations" DROP COLUMN IF EXISTS "type"`);
    await q.query(`ALTER TABLE IF EXISTS "stations" DROP COLUMN IF EXISTS "description"`);
    await q.query(`ALTER TABLE IF EXISTS "stations" DROP COLUMN IF EXISTS "code"`);
    await q.query(`DROP TYPE IF EXISTS "stations_status_enum"`);
    await q.query(`DROP TYPE IF EXISTS "stations_type_enum"`);
  }
}
