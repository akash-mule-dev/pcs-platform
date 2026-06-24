import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Project soft-delete + retention purge.
 *
 *  - projects.deleted_at (timestamptz, null)  — the @DeleteDateColumn marker.
 *    Set when a project is moved to the Trash; TypeORM auto-excludes non-null
 *    rows from every find/findOne. A scheduled sweep (ProjectPurgeService)
 *    permanently deletes projects whose deleted_at is older than the retention
 *    window (30 days), along with their whole owned subtree + storage blobs.
 *  - a partial index on the marker so the cross-org retention scan
 *    (`WHERE deleted_at IS NOT NULL AND deleted_at < cutoff`) stays cheap.
 *
 * Additive + idempotent + guarded: safe to re-run and safe to run after
 * `synchronize` has already applied the same column (DB_SYNCHRONIZE defaults on).
 * projects already carries organization_id, so it is covered by the generic
 * TenantRls policy — no extra RLS enrollment needed.
 */
export class ProjectSoftDelete1784000000000 implements MigrationInterface {
  name = 'ProjectSoftDelete1784000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'projects') THEN
          ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz NULL;
        END IF;
      END $$;
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "idx_projects_deleted_at" ON "projects" ("deleted_at") WHERE "deleted_at" IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_projects_deleted_at"`);
    await q.query(`ALTER TABLE IF EXISTS "projects" DROP COLUMN IF EXISTS "deleted_at"`);
  }
}
