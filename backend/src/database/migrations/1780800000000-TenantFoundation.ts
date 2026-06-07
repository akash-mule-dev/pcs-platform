import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 0a — multi-tenancy foundation (increment 1: the spine).
 *
 * - Ensures a "Default Organization" exists (the tenant existing data belongs to).
 * - Adds users.organization_id and backfills every existing user to the default org.
 *
 * Idempotent and safe to run alongside synchronize. Domain entities
 * (products, processes, work_orders, …) get their own organization_id columns in
 * subsequent increments as each module is made tenant-scoped.
 */
export class TenantFoundation1780800000000 implements MigrationInterface {
  name = 'TenantFoundation1780800000000';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Seed a default tenant for all pre-existing data.
    await q.query(`
      INSERT INTO organizations (id, name, slug, is_active)
      SELECT gen_random_uuid(), 'Default Organization', 'default', true
      WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE slug = 'default')
    `);

    // 2. Add the tenant column to users (no-op if synchronize already added it).
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id uuid`);

    // 3. Backfill existing users to the default tenant.
    await q.query(`
      UPDATE users
      SET organization_id = (SELECT id FROM organizations WHERE slug = 'default' LIMIT 1)
      WHERE organization_id IS NULL
    `);

    // 4. Index for tenant-scoped lookups.
    await q.query(`CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users (organization_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_users_organization_id`);
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS organization_id`);
    // The default organization row is left in place intentionally.
  }
}
