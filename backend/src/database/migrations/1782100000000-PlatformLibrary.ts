import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shared library ("super company"):
 *  - organizations.kind distinguishes the single `platform` org (library home)
 *    from normal `tenant` orgs.
 *  - processes / form_templates carry library_origin_id so content published
 *    from the library into a tenant can be updated in place (idempotent) and
 *    badged as "from library".
 * Idempotent.
 */
export class PlatformLibrary1782100000000 implements MigrationInterface {
  name = 'PlatformLibrary1782100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "kind" varchar(20) NOT NULL DEFAULT 'tenant'`);
    await q.query(`ALTER TABLE "processes" ADD COLUMN IF NOT EXISTS "library_origin_id" uuid`);
    await q.query(`ALTER TABLE "form_templates" ADD COLUMN IF NOT EXISTS "library_origin_id" uuid`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_processes_library_origin" ON "processes" ("library_origin_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_form_templates_library_origin" ON "form_templates" ("library_origin_id")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_form_templates_library_origin"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_processes_library_origin"`);
    await q.query(`ALTER TABLE "form_templates" DROP COLUMN IF EXISTS "library_origin_id"`);
    await q.query(`ALTER TABLE "processes" DROP COLUMN IF EXISTS "library_origin_id"`);
    await q.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "kind"`);
  }
}
