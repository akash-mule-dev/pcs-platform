import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes lifecycle status and due date from projects. A project is a pure
 * design container — status and due dates belong to its production orders
 * (each customer/run instance tracks its own).
 *
 * Idempotent and safe to run alongside `synchronize`.
 */
export class DropProjectStatusAndDueDate1781500000001 implements MigrationInterface {
  name = 'DropProjectStatusAndDueDate1781500000001';

  public async up(q: QueryRunner): Promise<void> {
    const hasTable = await q.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'projects'`);
    if (!hasTable?.length) return;

    await q.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "status"`);
    await q.query(`ALTER TABLE "projects" DROP COLUMN IF EXISTS "due_date"`);
    await q.query(`DROP TYPE IF EXISTS "projects_status_enum"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    const hasTable = await q.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'projects'`);
    if (!hasTable?.length) return;

    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'projects_status_enum') THEN
          CREATE TYPE "projects_status_enum" AS ENUM ('planning','active','on_hold','completed','archived');
        END IF;
      END $$;
    `);
    await q.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "status" "projects_status_enum" NOT NULL DEFAULT 'planning'`);
    await q.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "due_date" timestamp`);
  }
}
