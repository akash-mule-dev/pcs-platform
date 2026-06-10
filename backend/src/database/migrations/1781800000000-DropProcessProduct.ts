import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Processes are standalone workflow templates — no longer tied to a product.
 * Drop processes.product_id. Dropping the column automatically drops the
 * foreign key to products and the (product_id, version) unique constraint that
 * involve it. Idempotent.
 */
export class DropProcessProduct1781800000000 implements MigrationInterface {
  name = 'DropProcessProduct1781800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE IF EXISTS "processes" DROP COLUMN IF EXISTS "product_id"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'processes') THEN
          ALTER TABLE "processes" ADD COLUMN IF NOT EXISTS "product_id" uuid;
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products')
             AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_processes_product') THEN
            ALTER TABLE "processes" ADD CONSTRAINT "FK_processes_product"
              FOREIGN KEY ("product_id") REFERENCES "products"("id");
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_processes_product_version') THEN
            ALTER TABLE "processes" ADD CONSTRAINT "UQ_processes_product_version"
              UNIQUE ("product_id", "version");
          END IF;
        END IF;
      END $$;
    `);
  }
}
