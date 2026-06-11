import { MigrationInterface, QueryRunner } from 'typeorm';

/** QC reports: filled instances of form templates against production orders. Idempotent. */
export class AddQualityReports1781900000000 implements MigrationInterface {
  name = 'AddQualityReports1781900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quality_reports_status_enum') THEN
          CREATE TYPE "quality_reports_status_enum" AS ENUM ('draft', 'submitted');
        END IF;
      END $$;
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "quality_reports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid,
        "number" varchar(50) NOT NULL,
        "template_id" uuid,
        "template_name" varchar(255) NOT NULL,
        "template_schema" jsonb NOT NULL,
        "production_order_id" uuid NOT NULL,
        "project_id" uuid,
        "assembly_node_id" uuid,
        "data" jsonb,
        "status" "quality_reports_status_enum" NOT NULL DEFAULT 'draft',
        "filled_by" uuid,
        "submitted_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_quality_reports" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_quality_reports_number" UNIQUE ("number")
      )
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'production_orders')
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_quality_reports_order') THEN
          ALTER TABLE "quality_reports" ADD CONSTRAINT "FK_quality_reports_order"
            FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_quality_reports_order" ON "quality_reports" ("organization_id", "production_order_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_quality_reports_status" ON "quality_reports" ("organization_id", "status")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_quality_reports_status"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_quality_reports_order"`);
    await q.query(`DROP TABLE IF EXISTS "quality_reports"`);
    await q.query(`DROP TYPE IF EXISTS "quality_reports_status_enum"`);
  }
}
