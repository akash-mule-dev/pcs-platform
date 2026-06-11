import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the per-node production roll-up from assembly_nodes. A project is a
 * pure design container that can back MANY production orders, so a single
 * global status/percent per node is meaningless — tracking lives on each
 * order's work-order stages instead, and shipped quantities are derived from
 * shipment items.
 *
 * Idempotent and safe to run alongside `synchronize` (every statement is
 * guarded / IF EXISTS).
 */
export class DropAssemblyNodeStatusRollup1781500000000 implements MigrationInterface {
  name = 'DropAssemblyNodeStatusRollup1781500000000';

  public async up(q: QueryRunner): Promise<void> {
    const hasTable = await q.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'assembly_nodes'`);
    if (!hasTable?.length) return;

    await q.query(`ALTER TABLE "assembly_nodes" DROP CONSTRAINT IF EXISTS "FK_assembly_nodes_stage"`);
    await q.query(`ALTER TABLE "assembly_nodes" DROP COLUMN IF EXISTS "production_status"`);
    await q.query(`ALTER TABLE "assembly_nodes" DROP COLUMN IF EXISTS "current_stage_id"`);
    await q.query(`ALTER TABLE "assembly_nodes" DROP COLUMN IF EXISTS "percent_complete"`);
    await q.query(`ALTER TABLE "assembly_nodes" DROP COLUMN IF EXISTS "qty_complete"`);
    await q.query(`ALTER TABLE "assembly_nodes" DROP COLUMN IF EXISTS "qty_shipped"`);
    await q.query(`DROP TYPE IF EXISTS "assembly_nodes_production_status_enum"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    const hasTable = await q.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'assembly_nodes'`);
    if (!hasTable?.length) return;

    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assembly_nodes_production_status_enum') THEN
          CREATE TYPE "assembly_nodes_production_status_enum" AS ENUM ('not_started','in_progress','ready_to_ship','shipped','on_hold');
        END IF;
      END $$;
    `);
    await q.query(`ALTER TABLE "assembly_nodes" ADD COLUMN IF NOT EXISTS "production_status" "assembly_nodes_production_status_enum" NOT NULL DEFAULT 'not_started'`);
    await q.query(`ALTER TABLE "assembly_nodes" ADD COLUMN IF NOT EXISTS "current_stage_id" uuid`);
    await q.query(`ALTER TABLE "assembly_nodes" ADD COLUMN IF NOT EXISTS "percent_complete" numeric(5,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "assembly_nodes" ADD COLUMN IF NOT EXISTS "qty_complete" integer NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "assembly_nodes" ADD COLUMN IF NOT EXISTS "qty_shipped" integer NOT NULL DEFAULT 0`);
  }
}
