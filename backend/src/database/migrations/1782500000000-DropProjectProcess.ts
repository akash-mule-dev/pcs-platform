import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A project is a pure design container — it no longer carries a fabrication
 * Process. Stage routing is chosen per production order (and flows onto that
 * order's work orders), since one design can back many orders with different
 * routings, so a single project-level process is meaningless.
 *
 * Drop projects.process_id, its index and FK to processes. Idempotent — and the
 * inverse of AddProjectProcess1781600000000 (which still runs first; this then
 * removes the column it added). Dropping the column auto-drops the FK, but we
 * drop the named index/constraint explicitly first for clarity.
 */
export class DropProjectProcess1782500000000 implements MigrationInterface {
  name = 'DropProjectProcess1782500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_projects_process"`);
    await q.query(`ALTER TABLE IF EXISTS "projects" DROP CONSTRAINT IF EXISTS "FK_projects_process"`);
    await q.query(`ALTER TABLE IF EXISTS "projects" DROP COLUMN IF EXISTS "process_id"`);
  }

  public async down(q: QueryRunner): Promise<void> {
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
}
