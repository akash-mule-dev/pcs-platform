import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retire the standalone NCR / CAPA module — NCRs are now NCR-type QC reports.
 *
 * An NCR is a `quality_reports` row whose template type is `ncr`; it blocks the
 * shipping + quality-stage gates while `resolved_at` is null and is closed by an
 * explicit Resolve action. The gates, summaries and insights read those reports,
 * so the old `ncrs` / `capas` / `ncr_events` tables are dropped.
 *
 * Idempotent and safe to run alongside `synchronize` (every statement guarded).
 * In dev (`synchronize` ON, `migrationsRun` OFF) `synchronize` adds the new
 * quality_reports columns and leaves the old tables until this runs in prod
 * (`synchronize` OFF, `migrationsRun` ON) — at which point they are removed.
 *
 * One-way retirement: `down` removes only the additive quality_reports changes;
 * the NCR/CAPA tables are NOT recreated (the module is gone).
 */
export class RetireNcrModule1782700000007 implements MigrationInterface {
  name = 'RetireNcrModule1782700000007';

  public async up(q: QueryRunner): Promise<void> {
    // ── quality_reports: NCR identity + close ─────────────────────────────────
    // (synchronize may have added these already in dev — guarded either way.)
    await q.query(`ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "template_type" varchar(40)`);
    await q.query(`ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMP`);
    await q.query(`ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "resolved_by" uuid`);

    // Backfill the template-type snapshot for existing reports from their template.
    await q.query(`
      UPDATE "quality_reports" qr
         SET "template_type" = ft."type"
        FROM "form_templates" ft
       WHERE qr."template_id" = ft."id" AND qr."template_type" IS NULL
    `);

    // Gate lookups query by node (old ncrs carried IDX_ncrs_assembly_node).
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_quality_reports_org_node" ON "quality_reports" ("organization_id", "assembly_node_id")`);

    // ── Drop the retired NCR / CAPA tables (CASCADE clears FKs + RLS policies) ─
    await q.query(`DROP TABLE IF EXISTS "ncr_events" CASCADE`);
    await q.query(`DROP TABLE IF EXISTS "capas" CASCADE`);
    await q.query(`DROP TABLE IF EXISTS "ncrs" CASCADE`);

    // ── Drop their enum types (independent of the tables) ─────────────────────
    await q.query(`DROP TYPE IF EXISTS "ncr_events_type_enum"`);
    await q.query(`DROP TYPE IF EXISTS "ncrs_status_enum"`);
    await q.query(`DROP TYPE IF EXISTS "ncrs_severity_enum"`);
    await q.query(`DROP TYPE IF EXISTS "ncrs_disposition_enum"`);
    await q.query(`DROP TYPE IF EXISTS "capas_type_enum"`);
    await q.query(`DROP TYPE IF EXISTS "capas_status_enum"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // One-way retirement: only the additive quality_reports changes are reverted.
    await q.query(`DROP INDEX IF EXISTS "IDX_quality_reports_org_node"`);
    await q.query(`ALTER TABLE "quality_reports" DROP COLUMN IF EXISTS "resolved_by"`);
    await q.query(`ALTER TABLE "quality_reports" DROP COLUMN IF EXISTS "resolved_at"`);
    await q.query(`ALTER TABLE "quality_reports" DROP COLUMN IF EXISTS "template_type"`);
  }
}
