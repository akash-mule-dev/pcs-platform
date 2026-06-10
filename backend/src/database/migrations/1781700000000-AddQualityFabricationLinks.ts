import { MigrationInterface, QueryRunner } from 'typeorm';

/** Link quality records + NCRs to the fabrication assembly node / project. Idempotent. */
export class AddQualityFabricationLinks1781700000000 implements MigrationInterface {
  name = 'AddQualityFabricationLinks1781700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'quality_data') THEN
          ALTER TABLE "quality_data" ADD COLUMN IF NOT EXISTS "assembly_node_id" uuid;
          ALTER TABLE "quality_data" ADD COLUMN IF NOT EXISTS "project_id" uuid;
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assembly_nodes')
             AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_quality_data_assembly_node') THEN
            ALTER TABLE "quality_data" ADD CONSTRAINT "FK_quality_data_assembly_node"
              FOREIGN KEY ("assembly_node_id") REFERENCES "assembly_nodes"("id") ON DELETE SET NULL;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'projects')
             AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_quality_data_project') THEN
            ALTER TABLE "quality_data" ADD CONSTRAINT "FK_quality_data_project"
              FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
          END IF;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ncrs') THEN
          ALTER TABLE "ncrs" ADD COLUMN IF NOT EXISTS "assembly_node_id" uuid;
          ALTER TABLE "ncrs" ADD COLUMN IF NOT EXISTS "project_id" uuid;
          ALTER TABLE "ncrs" ADD COLUMN IF NOT EXISTS "quality_data_id" uuid;
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assembly_nodes')
             AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_ncrs_assembly_node') THEN
            ALTER TABLE "ncrs" ADD CONSTRAINT "FK_ncrs_assembly_node"
              FOREIGN KEY ("assembly_node_id") REFERENCES "assembly_nodes"("id") ON DELETE SET NULL;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'projects')
             AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_ncrs_project') THEN
            ALTER TABLE "ncrs" ADD CONSTRAINT "FK_ncrs_project"
              FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
          END IF;
        END IF;
      END $$;
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_quality_data_assembly_node" ON "quality_data" ("assembly_node_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_quality_data_project" ON "quality_data" ("project_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_ncrs_assembly_node" ON "ncrs" ("assembly_node_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_ncrs_project" ON "ncrs" ("project_id")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_ncrs_project"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_ncrs_assembly_node"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_quality_data_project"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_quality_data_assembly_node"`);
    await q.query(`ALTER TABLE IF EXISTS "ncrs" DROP CONSTRAINT IF EXISTS "FK_ncrs_project"`);
    await q.query(`ALTER TABLE IF EXISTS "ncrs" DROP CONSTRAINT IF EXISTS "FK_ncrs_assembly_node"`);
    await q.query(`ALTER TABLE IF EXISTS "ncrs" DROP COLUMN IF EXISTS "quality_data_id"`);
    await q.query(`ALTER TABLE IF EXISTS "ncrs" DROP COLUMN IF EXISTS "project_id"`);
    await q.query(`ALTER TABLE IF EXISTS "ncrs" DROP COLUMN IF EXISTS "assembly_node_id"`);
    await q.query(`ALTER TABLE IF EXISTS "quality_data" DROP CONSTRAINT IF EXISTS "FK_quality_data_project"`);
    await q.query(`ALTER TABLE IF EXISTS "quality_data" DROP CONSTRAINT IF EXISTS "FK_quality_data_assembly_node"`);
    await q.query(`ALTER TABLE IF EXISTS "quality_data" DROP COLUMN IF EXISTS "project_id"`);
    await q.query(`ALTER TABLE IF EXISTS "quality_data" DROP COLUMN IF EXISTS "assembly_node_id"`);
  }
}
