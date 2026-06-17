import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4 (costing precision) — per-stage overhead.
 *
 * Adds stages.overhead_percent — overhead/burden applied on that stage's labor
 * (NULL = fall back to the org default in costing settings; 0 = no overhead).
 * Lets welding ≠ painting burden instead of one flat org-wide %. Idempotent +
 * guarded so it's safe to re-run and runs cleanly after `synchronize`.
 */
export class StageOverhead1782700000006 implements MigrationInterface {
  name = 'StageOverhead1782700000006';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stages') THEN
          ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "overhead_percent" NUMERIC(6,2) NULL;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE IF EXISTS "stages" DROP COLUMN IF EXISTS "overhead_percent"`);
  }
}
