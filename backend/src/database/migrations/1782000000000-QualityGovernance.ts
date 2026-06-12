import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Production-hardening of the quality module. Idempotent.
 *
 *  - quality_data: server-stamped identity columns (inspector_user_id,
 *    signoff_by_user_id) + tenant-first indexes for the hot lookups.
 *  - ncrs: per-organization unique numbering, closed_by stamp, gate index.
 *  - quality_reports: numbering goes per-organization (drop the global
 *    UNIQUE("number"), add UNIQUE(organization_id, number)).
 *  - ncr_events: NEW append-only NCR timeline table.
 *  - capas: verified_at stamp.
 */
export class QualityGovernance1782000000000 implements MigrationInterface {
  name = 'QualityGovernance1782000000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── quality_data ──────────────────────────────────────────────────────────
    await q.query(`ALTER TABLE "quality_data" ADD COLUMN IF NOT EXISTS "inspector_user_id" uuid`);
    await q.query(`ALTER TABLE "quality_data" ADD COLUMN IF NOT EXISTS "signoff_by_user_id" uuid`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_quality_data_org_model" ON "quality_data" ("organization_id", "model_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_quality_data_org_project" ON "quality_data" ("organization_id", "project_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_quality_data_org_node" ON "quality_data" ("organization_id", "assembly_node_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_quality_data_org_signoff" ON "quality_data" ("organization_id", "signoff_status", "status")`);

    // ── ncrs ──────────────────────────────────────────────────────────────────
    await q.query(`ALTER TABLE "ncrs" ADD COLUMN IF NOT EXISTS "closed_by" uuid`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_ncrs_assembly_node" ON "ncrs" ("assembly_node_id")`);
    // Unique per-org numbering (skip if legacy duplicates would block it).
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'UQ_ncrs_org_number') THEN
          IF NOT EXISTS (
            SELECT organization_id, number FROM ncrs GROUP BY organization_id, number HAVING COUNT(*) > 1
          ) THEN
            CREATE UNIQUE INDEX "UQ_ncrs_org_number" ON "ncrs" ("organization_id", "number");
          END IF;
        END IF;
      END $$;
    `);

    // ── quality_reports: global → per-org unique number ───────────────────────
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_quality_reports_number') THEN
          ALTER TABLE "quality_reports" DROP CONSTRAINT "UQ_quality_reports_number";
        END IF;
      END $$;
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_quality_reports_org_number" ON "quality_reports" ("organization_id", "number")`);

    // ── capas ─────────────────────────────────────────────────────────────────
    await q.query(`ALTER TABLE "capas" ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP`);

    // ── ncr_events (timeline) ─────────────────────────────────────────────────
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ncr_events_type_enum') THEN
          CREATE TYPE "ncr_events_type_enum" AS ENUM ('created', 'status_change', 'disposition', 'assignment', 'comment');
        END IF;
      END $$;
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ncr_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid,
        "ncr_id" uuid NOT NULL,
        "type" "ncr_events_type_enum" NOT NULL,
        "from_status" varchar(30),
        "to_status" varchar(30),
        "note" text,
        "actor_user_id" uuid,
        "actor_name" varchar(200),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ncr_events" PRIMARY KEY ("id")
      )
    `);
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_ncr_events_ncr') THEN
          ALTER TABLE "ncr_events" ADD CONSTRAINT "FK_ncr_events_ncr"
            FOREIGN KEY ("ncr_id") REFERENCES "ncrs"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_ncr_events_org_ncr" ON "ncr_events" ("organization_id", "ncr_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_ncr_events_ncr" ON "ncr_events" ("ncr_id")`);

    // RLS backstop for the new tenant-owned table (same policy as TenantRls).
    await q.query(`
      DO $$
      BEGIN
        EXECUTE 'ALTER TABLE ncr_events ENABLE ROW LEVEL SECURITY';
        EXECUTE 'ALTER TABLE ncr_events FORCE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON ncr_events';
        EXECUTE $p$
          CREATE POLICY tenant_isolation ON ncr_events
          USING (
            NULLIF(current_setting('app.current_org', true), '') IS NULL
            OR organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
          )
          WITH CHECK (
            NULLIF(current_setting('app.current_org', true), '') IS NULL
            OR organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
          )
        $p$;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ncr_events"`);
    await q.query(`DROP TYPE IF EXISTS "ncr_events_type_enum"`);
    await q.query(`ALTER TABLE "capas" DROP COLUMN IF EXISTS "verified_at"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_quality_reports_org_number"`);
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_quality_reports_number') THEN
          ALTER TABLE "quality_reports" ADD CONSTRAINT "UQ_quality_reports_number" UNIQUE ("number");
        END IF;
      END $$;
    `);
    await q.query(`DROP INDEX IF EXISTS "UQ_ncrs_org_number"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_ncrs_assembly_node"`);
    await q.query(`ALTER TABLE "ncrs" DROP COLUMN IF EXISTS "closed_by"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_quality_data_org_signoff"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_quality_data_org_node"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_quality_data_org_project"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_quality_data_org_model"`);
    await q.query(`ALTER TABLE "quality_data" DROP COLUMN IF EXISTS "signoff_by_user_id"`);
    await q.query(`ALTER TABLE "quality_data" DROP COLUMN IF EXISTS "inspector_user_id"`);
  }
}
