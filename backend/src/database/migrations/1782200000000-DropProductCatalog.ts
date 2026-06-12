import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The product catalog is removed — projects (AssemblyNode / ProductionOrder)
 * drive all fabrication, so nothing references products any more. Drop the
 * products and bom_items tables and every surviving product_id column.
 * Dropping a column automatically drops the foreign keys that involve it
 * (work_orders/models → products), so no constraint is referenced by its
 * hashed name. Column drops first, table drops last. Idempotent.
 */
export class DropProductCatalog1782200000000 implements MigrationInterface {
  name = 'DropProductCatalog1782200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE IF EXISTS "work_orders" DROP COLUMN IF EXISTS "product_id"`);
    await q.query(`ALTER TABLE IF EXISTS "models" DROP COLUMN IF EXISTS "product_id"`);
    await q.query(`ALTER TABLE IF EXISTS "conversion_jobs" DROP COLUMN IF EXISTS "product_id"`);
    await q.query(`ALTER TABLE IF EXISTS "ncrs" DROP COLUMN IF EXISTS "product_id"`);
    await q.query(`ALTER TABLE IF EXISTS "serial_units" DROP COLUMN IF EXISTS "product_id"`);
    await q.query(`DROP TABLE IF EXISTS "bom_items"`);
    await q.query(`DROP TABLE IF EXISTS "products"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Structure-only restore — the dropped rows are not recoverable, and the
    // re-added columns come back nullable (the old NOT NULLs can't be
    // reinstated against existing rows).
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') THEN
          CREATE TABLE "products" (
            "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            "name" character varying NOT NULL,
            "description" text,
            "is_active" boolean NOT NULL DEFAULT true,
            "organization_id" uuid,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            "updated_at" TIMESTAMP NOT NULL DEFAULT now()
          );
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bom_items') THEN
          CREATE TABLE "bom_items" (
            "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            "organization_id" uuid,
            "product_id" uuid NOT NULL,
            "material_id" uuid NOT NULL,
            "quantity_per" numeric(12,4) NOT NULL DEFAULT 1,
            "scrap_pct" numeric(5,2) NOT NULL DEFAULT 0,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            "updated_at" TIMESTAMP NOT NULL DEFAULT now()
          );
          CREATE UNIQUE INDEX "UQ_bom_items_org_product_material"
            ON "bom_items" ("organization_id", "product_id", "material_id");
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'materials') THEN
            ALTER TABLE "bom_items" ADD CONSTRAINT "FK_bom_items_material"
              FOREIGN KEY ("material_id") REFERENCES "materials"("id");
          END IF;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_orders') THEN
          ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "product_id" uuid;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_work_orders_product') THEN
            ALTER TABLE "work_orders" ADD CONSTRAINT "FK_work_orders_product"
              FOREIGN KEY ("product_id") REFERENCES "products"("id");
          END IF;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'models') THEN
          ALTER TABLE "models" ADD COLUMN IF NOT EXISTS "product_id" uuid;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_models_product') THEN
            ALTER TABLE "models" ADD CONSTRAINT "FK_models_product"
              FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL;
          END IF;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversion_jobs') THEN
          ALTER TABLE "conversion_jobs" ADD COLUMN IF NOT EXISTS "product_id" uuid;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ncrs') THEN
          ALTER TABLE "ncrs" ADD COLUMN IF NOT EXISTS "product_id" uuid;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'serial_units') THEN
          ALTER TABLE "serial_units" ADD COLUMN IF NOT EXISTS "product_id" uuid;
        END IF;
      END $$;
    `);
  }
}
