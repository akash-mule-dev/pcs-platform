import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shipping belongs to the WORK ORDER, not the project. Adds
 * shipments.production_order_id (the owning production order), an FK + index,
 * and backfills existing loads: where a load's project has exactly ONE
 * production order, point the load at it; ambiguous projects (>1 order) are
 * left NULL — those legacy loads simply won't surface under any order until
 * reassigned. Idempotent + guarded so it's safe to re-run / runs after
 * `synchronize` has already added the column. project_id is retained (delivery
 * note header + heat rollup), so nothing is dropped.
 */
export class ShipmentProductionOrder1782600000000 implements MigrationInterface {
  name = 'ShipmentProductionOrder1782600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shipments') THEN
          ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "production_order_id" uuid;
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'production_orders')
             AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_shipments_production_order') THEN
            ALTER TABLE "shipments" ADD CONSTRAINT "FK_shipments_production_order"
              FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE;
          END IF;
        END IF;
      END $$;
    `);
    // Backfill: single-order projects only (unambiguous).
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shipments')
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'production_orders') THEN
          UPDATE "shipments" s
             SET "production_order_id" = po.id
            FROM (
              SELECT project_id, MIN(id) AS id
                FROM "production_orders"
               GROUP BY project_id
              HAVING COUNT(*) = 1
            ) po
           WHERE s."production_order_id" IS NULL
             AND s."project_id" = po.project_id;
        END IF;
      END $$;
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_shipments_production_order" ON "shipments" ("organization_id", "production_order_id")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_shipments_production_order"`);
    await q.query(`ALTER TABLE IF EXISTS "shipments" DROP CONSTRAINT IF EXISTS "FK_shipments_production_order"`);
    await q.query(`ALTER TABLE IF EXISTS "shipments" DROP COLUMN IF EXISTS "production_order_id"`);
  }
}
