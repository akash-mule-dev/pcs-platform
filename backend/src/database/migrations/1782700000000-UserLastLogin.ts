import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds users.last_login_at — the timestamp of each user's most recent
 * successful password login. A true engagement signal (audit logs only capture
 * mutations, so view-only sessions never show up there); surfaced by the
 * platform Company Insights. Idempotent + guarded so it's safe to re-run and
 * runs cleanly after `synchronize` has already added the column.
 */
export class UserLastLogin1782700000000 implements MigrationInterface {
  name = 'UserLastLogin1782700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
          ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP NULL;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE IF EXISTS "users" DROP COLUMN IF EXISTS "last_login_at"`);
  }
}
