import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds users.tour_state (jsonb) — per-user guided-tour state, a map of
 * `{ [tourId]: version }` for tours the user has completed/dismissed. Moves
 * onboarding "seen" state off the browser (localStorage) so it follows the user
 * across devices. Idempotent + guarded so it's safe to re-run and runs cleanly
 * after `synchronize` has already added the column.
 */
export class UserTourState1782700000008 implements MigrationInterface {
  name = 'UserTourState1782700000008';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
          ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tour_state" JSONB NULL;
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE IF EXISTS "users" DROP COLUMN IF EXISTS "tour_state"`);
  }
}
