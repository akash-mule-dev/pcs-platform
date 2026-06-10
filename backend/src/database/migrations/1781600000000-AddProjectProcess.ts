import { MigrationInterface, QueryRunner } from 'typeorm';

/** Attach a fabrication Process to a Project (projects.process_id). Idempotent. */
export class AddProjectProcess1781600000000 implements MigrationInterface {
  name = 'AddProjectProcess1781600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'projects') THEN
          ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "process_id" uuid;
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'processes')
             AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_projects_process') THEN
            ALTER TABLE "projects" ADD CONSTRAINT "FK_projects_process"
              FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE SET NULL;
          END IF;
        END IF;
      END $$;
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_projects_process" ON "projects" ("process_id")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_projects_process"`);
    await q.query(`ALTER TABLE IF EXISTS "projects" DROP CONSTRAINT IF EXISTS "FK_projects_process"`);
    await q.query(`ALTER TABLE IF EXISTS "projects" DROP COLUMN IF EXISTS "process_id"`);
  }
}
