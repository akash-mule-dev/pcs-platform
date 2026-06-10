import { MigrationInterface, QueryRunner } from 'typeorm';

/** Multi-order support: production_orders + per-order work-order link + count-based stage qty. Idempotent. */
export class AddProductionOrders1781800000000 implements MigrationInterface {
  name = 'AddProductionOrders1781800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'production_orders_status_enum') THEN
          CREATE TYPE "production_orders_status_enum" AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');
        END IF;
      END $$;
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "production_orders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid,
        "project_id" uuid NOT NULL,
        "number" varchar(50) NOT NULL,
        "customer_name" varchar(255),
        "quantity" integer NOT NULL DEFAULT 1,
        "process_id" uuid,
        "status" "production_orders_status_enum" NOT NULL DEFAULT 'planned',
        "due_date" TIMESTAMP,
        "notes" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_production_orders" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_production_orders_number" UNIQUE ("number")
      )
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'projects')
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_production_orders_project') THEN
          ALTER TABLE "production_orders" ADD CONSTRAINT "FK_production_orders_project"
            FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_orders') THEN
          ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "production_order_id" uuid;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_work_orders_production_order') THEN
            ALTER TABLE "work_orders" ADD CONSTRAINT "FK_work_orders_production_order"
              FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE;
          END IF;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_order_stages') THEN
          ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "qty_total" integer;
          ALTER TABLE "work_order_stages" ADD COLUMN IF NOT EXISTS "qty_done" integer NOT NULL DEFAULT 0;
        END IF;
      END $$;
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_production_orders_project" ON "production_orders" ("organization_id", "project_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_work_orders_production_order" ON "work_orders" ("production_order_id")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_work_orders_production_order"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_production_orders_project"`);
    await q.query(`ALTER TABLE IF EXISTS "work_order_stages" DROP COLUMN IF EXISTS "qty_done"`);
    await q.query(`ALTER TABLE IF EXISTS "work_order_stages" DROP COLUMN IF EXISTS "qty_total"`);
    await q.query(`ALTER TABLE IF EXISTS "work_orders" DROP CONSTRAINT IF EXISTS "FK_work_orders_production_order"`);
    await q.query(`ALTER TABLE IF EXISTS "work_orders" DROP COLUMN IF EXISTS "production_order_id"`);
    await q.query(`DROP TABLE IF EXISTS "production_orders"`);
    await q.query(`DROP TYPE IF EXISTS "production_orders_status_enum"`);
  }
}
