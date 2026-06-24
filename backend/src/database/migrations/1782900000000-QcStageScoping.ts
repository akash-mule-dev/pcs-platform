import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-stage QC + an explicit final-QC release gate.
 *
 *  - `stages.is_final_qc` (tri-state boolean): marks the terminal FINAL QC /
 *    release stage. The quality gate now keys on this flag, with the legacy
 *    `isQualityStageName` name match kept ONLY as a fallback when the flag is
 *    NULL — so pre-existing "Quality Check" stages keep gating unchanged. The
 *    backfill promotes each process's highest-sequence quality-named stage to
 *    `is_final_qc = true` (one explicit gate per process).
 *  - `quality_reports.stage_id` / `work_order_stage_id` and
 *    `quality_data.stage_id` / `work_order_stage_id`: the OPERATION a
 *    nonconformity / inspection was found at. A per-stage HOLD point gates on
 *    only its own stage's NCRs; the FINAL QC stage consolidates every stage's
 *    NCRs (assembly-wide). Null = no operation context (counts toward the
 *    final-QC rollup only).
 *
 * Idempotent and safe to run alongside `synchronize` (dev adds the columns
 * automatically; this guarantees prod parity). No FKs on the stage links — they
 * are advisory scoping keys and must survive a WorkOrderStage / Stage rebuild.
 */
export class QcStageScoping1782900000000 implements MigrationInterface {
  name = 'QcStageScoping1782900000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── stages: explicit final-QC gate flag ──────────────────────────────────
    await q.query(`ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "is_final_qc" boolean`);

    // Promote the terminal quality-named stage of each process to the explicit
    // final-QC gate (one per process). Other quality-named stages stay NULL and
    // keep gating via the name fallback, so nothing regresses.
    await q.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY process_id ORDER BY sequence DESC) AS rn
          FROM "stages"
         WHERE name ~* '(quality|inspect|\\yqc\\y|\\yqa\\y)'
      )
      UPDATE "stages" s
         SET "is_final_qc" = true
        FROM ranked r
       WHERE s.id = r.id AND r.rn = 1 AND s."is_final_qc" IS NULL
    `);

    // ── quality_reports: operation (stage) the NCR was raised at ─────────────
    await q.query(`ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "stage_id" uuid`);
    await q.query(`ALTER TABLE "quality_reports" ADD COLUMN IF NOT EXISTS "work_order_stage_id" uuid`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_qr_org_node_stage" ON "quality_reports" ("organization_id", "assembly_node_id", "stage_id")`,
    );

    // ── quality_data: operation (stage) the inspection was recorded at ───────
    await q.query(`ALTER TABLE "quality_data" ADD COLUMN IF NOT EXISTS "stage_id" uuid`);
    await q.query(`ALTER TABLE "quality_data" ADD COLUMN IF NOT EXISTS "work_order_stage_id" uuid`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_qd_org_node_stage" ON "quality_data" ("organization_id", "assembly_node_id", "stage_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_qd_org_node_stage"`);
    await q.query(`ALTER TABLE "quality_data" DROP COLUMN IF EXISTS "work_order_stage_id"`);
    await q.query(`ALTER TABLE "quality_data" DROP COLUMN IF EXISTS "stage_id"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_qr_org_node_stage"`);
    await q.query(`ALTER TABLE "quality_reports" DROP COLUMN IF EXISTS "work_order_stage_id"`);
    await q.query(`ALTER TABLE "quality_reports" DROP COLUMN IF EXISTS "stage_id"`);
    await q.query(`ALTER TABLE "stages" DROP COLUMN IF EXISTS "is_final_qc"`);
  }
}
