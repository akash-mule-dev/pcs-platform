import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persistent revision-management markers. The revision diff (added/changed/
 * missing) was already computed per import and stored in `import_files.revision`,
 * but only ever recomputed on demand — never persisted onto the tree or work
 * orders. These columns make "this assembly was revised" and "this work order is
 * affected by a revision" first-class, queryable state so the UI can badge them
 * and a reviewer can acknowledge them.
 *
 * - assembly_nodes: which nodes the LATEST revision added/changed + per-piece ack.
 * - work_orders: review-only staleness flag (never blocks/changes production).
 * - import_files: whole-revision "reviewed" stamp.
 *
 * Idempotent and safe alongside `synchronize` (dev adds the columns automatically;
 * this guarantees prod parity). No new tables → no RLS enrolment needed.
 */
export class RevisionMarkers1783000000000 implements MigrationInterface {
  name = 'RevisionMarkers1783000000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── assembly_nodes: per-node revision marker + per-piece acknowledgement ──
    await q.query(`ALTER TABLE "assembly_nodes" ADD COLUMN IF NOT EXISTS "revision_status" varchar(10)`);
    await q.query(`ALTER TABLE "assembly_nodes" ADD COLUMN IF NOT EXISTS "revised_by_import_id" uuid`);
    await q.query(`ALTER TABLE "assembly_nodes" ADD COLUMN IF NOT EXISTS "revision_acked_at" TIMESTAMPTZ`);
    await q.query(`ALTER TABLE "assembly_nodes" ADD COLUMN IF NOT EXISTS "revision_acked_by_id" uuid`);
    // Partial index: cheap lookup of unacked revised nodes per project.
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_assembly_nodes_revision" ON "assembly_nodes" ("organization_id", "project_id") WHERE "revision_status" IS NOT NULL`,
    );

    // ── work_orders: review-only revision staleness flag ─────────────────────
    await q.query(`ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "revision_flagged_import_id" uuid`);
    await q.query(`ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "revision_flagged_at" TIMESTAMPTZ`);
    await q.query(`ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "revision_acked_at" TIMESTAMPTZ`);
    await q.query(`ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "revision_acked_by_id" uuid`);

    // ── import_files: whole-revision reviewed stamp ──────────────────────────
    await q.query(`ALTER TABLE "import_files" ADD COLUMN IF NOT EXISTS "revision_reviewed_at" TIMESTAMPTZ`);
    await q.query(`ALTER TABLE "import_files" ADD COLUMN IF NOT EXISTS "revision_reviewed_by_id" uuid`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_assembly_nodes_revision"`);
    await q.query(`ALTER TABLE "assembly_nodes" DROP COLUMN IF EXISTS "revision_acked_by_id"`);
    await q.query(`ALTER TABLE "assembly_nodes" DROP COLUMN IF EXISTS "revision_acked_at"`);
    await q.query(`ALTER TABLE "assembly_nodes" DROP COLUMN IF EXISTS "revised_by_import_id"`);
    await q.query(`ALTER TABLE "assembly_nodes" DROP COLUMN IF EXISTS "revision_status"`);
    await q.query(`ALTER TABLE "work_orders" DROP COLUMN IF EXISTS "revision_acked_by_id"`);
    await q.query(`ALTER TABLE "work_orders" DROP COLUMN IF EXISTS "revision_acked_at"`);
    await q.query(`ALTER TABLE "work_orders" DROP COLUMN IF EXISTS "revision_flagged_at"`);
    await q.query(`ALTER TABLE "work_orders" DROP COLUMN IF EXISTS "revision_flagged_import_id"`);
    await q.query(`ALTER TABLE "import_files" DROP COLUMN IF EXISTS "revision_reviewed_by_id"`);
    await q.query(`ALTER TABLE "import_files" DROP COLUMN IF EXISTS "revision_reviewed_at"`);
  }
}
