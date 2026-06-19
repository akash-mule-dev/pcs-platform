import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Full NCR lifecycle on the QualityReport(template_type='ncr') model — no
 * resurrected `ncrs` table. Adds the disposition + investigation columns and an
 * append-only `quality_report_events` activity log, and backfills `ncr_status`
 * for existing NCRs from their `resolved_at`.
 *
 * The shipping + quality-stage GATES are unchanged: they still key on
 * `resolved_at IS NULL`. `ncr_status` is the richer UI/timeline state
 * (open → under_review → dispositioned → closed, + cancelled); only CLOSE and
 * CANCEL stamp `resolved_at`, so the gate semantics are preserved exactly.
 *
 * Idempotent and safe to run alongside `synchronize` (dev adds the columns/table
 * automatically; this guarantees prod parity, incl. RLS on the new table).
 */
export class NcrLifecycle1782800000000 implements MigrationInterface {
  name = 'NcrLifecycle1782800000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── quality_reports: disposition + investigation + status ────────────────
    await q.query(`ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "ncr_status" varchar(24)`);
    await q.query(`ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "disposition" varchar(24)`);
    await q.query(`ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "disposition_notes" text`);
    await q.query(`ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "disposition_by" uuid`);
    await q.query(`ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "disposition_at" TIMESTAMP`);
    await q.query(`ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "root_cause" text`);
    await q.query(`ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "corrective_action" text`);

    // Backfill status for existing NCRs from the gate timestamp.
    await q.query(`
      UPDATE "quality_reports"
         SET "ncr_status" = CASE WHEN "resolved_at" IS NULL THEN 'open' ELSE 'closed' END
       WHERE "template_type" = 'ncr' AND "ncr_status" IS NULL
    `);

    // ── quality_report_events: append-only activity log ──────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "quality_report_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "report_id" uuid NOT NULL,
        "type" varchar(24) NOT NULL,
        "from_status" varchar(24),
        "to_status" varchar(24),
        "disposition" varchar(24),
        "note" text,
        "created_by" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_quality_report_events" PRIMARY KEY ("id")
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_qre_org_report" ON "quality_report_events" ("organization_id", "report_id")`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_qre_report') THEN
          ALTER TABLE "quality_report_events"
            ADD CONSTRAINT "FK_qre_report" FOREIGN KEY ("report_id")
            REFERENCES "quality_reports"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // ── Row-Level Security for the new table (mirror tenant_isolation) ───────
    await q.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'quality_report_events') THEN
          ALTER TABLE "quality_report_events" ENABLE ROW LEVEL SECURITY;
          ALTER TABLE "quality_report_events" FORCE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS tenant_isolation ON "quality_report_events";
          CREATE POLICY tenant_isolation ON "quality_report_events"
            USING (
              NULLIF(current_setting('app.current_org', true), '') IS NULL
              OR organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
            )
            WITH CHECK (
              NULLIF(current_setting('app.current_org', true), '') IS NULL
              OR organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
            );
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "quality_report_events" CASCADE`);
    await q.query(`ALTER TABLE "quality_reports" DROP COLUMN IF EXISTS "corrective_action"`);
    await q.query(`ALTER TABLE "quality_reports" DROP COLUMN IF EXISTS "root_cause"`);
    await q.query(`ALTER TABLE "quality_reports" DROP COLUMN IF EXISTS "disposition_at"`);
    await q.query(`ALTER TABLE "quality_reports" DROP COLUMN IF EXISTS "disposition_by"`);
    await q.query(`ALTER TABLE "quality_reports" DROP COLUMN IF EXISTS "disposition_notes"`);
    await q.query(`ALTER TABLE "quality_reports" DROP COLUMN IF EXISTS "disposition"`);
    await q.query(`ALTER TABLE "quality_reports" DROP COLUMN IF EXISTS "ncr_status"`);
  }
}
