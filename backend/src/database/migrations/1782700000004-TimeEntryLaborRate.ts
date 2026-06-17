import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 (costing precision) — labor stamping & setup split.
 *
 * Adds time_entries.labor_rate (the worker/stage rate resolved + frozen at
 * clock-out, so a later rate change never rewrites historical labor cost — the
 * labor analog of stock_movements.unit_cost) and time_entries.is_setup (setup
 * vs run time, for the labor cost split). Idempotent + guarded so it's safe to
 * re-run and runs cleanly after `synchronize` has already added the columns.
 */
export class TimeEntryLaborRate1782700000004 implements MigrationInterface {
  name = 'TimeEntryLaborRate1782700000004';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'time_entries') THEN
          ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "labor_rate" NUMERIC(10,2) NULL;
          ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "is_setup" BOOLEAN NOT NULL DEFAULT false;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE IF EXISTS "time_entries" DROP COLUMN IF EXISTS "labor_rate"`);
    await q.query(`ALTER TABLE IF EXISTS "time_entries" DROP COLUMN IF EXISTS "is_setup"`);
  }
}
