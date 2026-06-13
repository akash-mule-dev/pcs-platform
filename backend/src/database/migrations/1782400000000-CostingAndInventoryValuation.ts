import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Work-order costing + inventory valuation. Idempotent.
 *
 *  - materials: BOM matching keys (profile, material_grade) so assembly-tree
 *    parts map onto stockable material masters.
 *  - stock_movements: stamped unit_cost (moving average at movement time) +
 *    production_order_id link (per-order requirements & costing), 'return'
 *    movement type, tenant-first indexes for the costing aggregates.
 *  - users.hourly_rate / stages.hourly_rate: labor-rate resolution chain
 *    (worker → stage → org default from organizations.settings.costing).
 *
 * All touched tables already exist and are RLS-enrolled by TenantRls; columns
 * only — no new tables, no policy changes needed.
 */
export class CostingAndInventoryValuation1782400000000 implements MigrationInterface {
  name = 'CostingAndInventoryValuation1782400000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── materials: BOM matching keys ─────────────────────────────────────────
    await q.query(`ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "profile" varchar(120)`);
    await q.query(`ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "material_grade" varchar(60)`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_materials_org_profile_grade" ON "materials" ("organization_id", "profile", "material_grade")`);

    // ── stock_movements: valuation stamp + production-order link ─────────────
    await q.query(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "unit_cost" numeric(12,2)`);
    await q.query(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "production_order_id" uuid`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_stock_movements_org_po" ON "stock_movements" ("organization_id", "production_order_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_stock_movements_org_wo" ON "stock_movements" ("organization_id", "work_order_id")`);

    // New movement type for issue reversals. ADD VALUE IF NOT EXISTS is
    // PG12+; safe inside the migration transaction as long as nothing in this
    // same transaction inserts a row using it (nothing here does).
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_movements_type_enum') THEN
          ALTER TYPE "stock_movements_type_enum" ADD VALUE IF NOT EXISTS 'return';
        END IF;
      END $$;
    `);

    // ── labor rates ──────────────────────────────────────────────────────────
    await q.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hourly_rate" numeric(10,2)`);
    await q.query(`ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "hourly_rate" numeric(10,2)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "stages" DROP COLUMN IF EXISTS "hourly_rate"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "hourly_rate"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_stock_movements_org_wo"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_stock_movements_org_po"`);
    await q.query(`ALTER TABLE "stock_movements" DROP COLUMN IF EXISTS "production_order_id"`);
    await q.query(`ALTER TABLE "stock_movements" DROP COLUMN IF EXISTS "unit_cost"`);
    // PG cannot drop a single enum value — 'return' stays (harmless).
    await q.query(`DROP INDEX IF EXISTS "IDX_materials_org_profile_grade"`);
    await q.query(`ALTER TABLE "materials" DROP COLUMN IF EXISTS "material_grade"`);
    await q.query(`ALTER TABLE "materials" DROP COLUMN IF EXISTS "profile"`);
  }
}
