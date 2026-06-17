import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 (costing precision) — machine / work-center costing.
 *
 *  - stations.machine_rate   — work-center machine burden $/h (the rate costing
 *                              charges on attended station time).
 *  - equipment.hourly_rate   — per-asset machine-hour rate (analytics + a hint
 *                              for the station rate).
 *  - stages.machine_time_seconds / machine_rate — planned machine seconds/unit
 *                              and standard rate for the machine ESTIMATE + proxy.
 *  - time_entries.machine_rate — the station rate frozen at clock-out.
 *
 * Idempotent + guarded so it's safe to re-run and runs cleanly after
 * `synchronize` has already added the columns.
 */
export class MachineCosting1782700000005 implements MigrationInterface {
  name = 'MachineCosting1782700000005';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stations') THEN
          ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "machine_rate" NUMERIC(12,2) NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'equipment') THEN
          ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "hourly_rate" NUMERIC(12,2) NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stages') THEN
          ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "machine_time_seconds" INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "machine_rate" NUMERIC(12,2) NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'time_entries') THEN
          ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "machine_rate" NUMERIC(12,2) NULL;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE IF EXISTS "stations" DROP COLUMN IF EXISTS "machine_rate"`);
    await q.query(`ALTER TABLE IF EXISTS "equipment" DROP COLUMN IF EXISTS "hourly_rate"`);
    await q.query(`ALTER TABLE IF EXISTS "stages" DROP COLUMN IF EXISTS "machine_time_seconds"`);
    await q.query(`ALTER TABLE IF EXISTS "stages" DROP COLUMN IF EXISTS "machine_rate"`);
    await q.query(`ALTER TABLE IF EXISTS "time_entries" DROP COLUMN IF EXISTS "machine_rate"`);
  }
}
