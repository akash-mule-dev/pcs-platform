import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tenant isolation backstop — Postgres Row-Level Security.
 *
 * Applies, to EVERY table that has an `organization_id` column, a policy that
 * restricts rows to the current request's organization. The org is read from the
 * `app.current_org` GUC, which the application sets per request (see
 * backend/TENANCY.md). When the GUC is unset/empty — migrations, the boot
 * backfill, background jobs, unauthenticated routes — the policy allows all rows
 * so system tasks keep working. `FORCE ROW LEVEL SECURITY` makes the policy apply
 * even to the table owner (the app's DB role on managed Postgres such as Neon).
 *
 * Run AFTER the baseline schema migration. The list is driven from
 * information_schema, so it automatically covers any future tenant-owned table
 * and is safe to re-run.
 */
export class TenantRls1781300000000 implements MigrationInterface {
  name = 'TenantRls1781300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'organization_id'
        LOOP
          EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
          EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.table_name);
          EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.table_name);
          EXECUTE format($p$
            CREATE POLICY tenant_isolation ON %I
            USING (
              NULLIF(current_setting('app.current_org', true), '') IS NULL
              OR organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
            )
            WITH CHECK (
              NULLIF(current_setting('app.current_org', true), '') IS NULL
              OR organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
            )
          $p$, r.table_name);
        END LOOP;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'organization_id'
        LOOP
          EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.table_name);
          EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', r.table_name);
          EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', r.table_name);
        END LOOP;
      END $$;
    `);
  }
}
