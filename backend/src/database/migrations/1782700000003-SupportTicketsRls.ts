import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enrol the support tables in Row-Level Security.
 *
 * The generic TenantRls migration (1781300000000) is driven from
 * information_schema at the time it runs, so it only covers tables that already
 * existed then. The support tables were added later (1782200000000), so they
 * never received the `tenant_isolation` policy. This applies the SAME policy to
 * `support_tickets` and `support_ticket_messages`: rows are restricted to the
 * request's `app.current_org` GUC, and when the GUC is unset (migrations, the
 * org-less platform support desk, background jobs) all rows are allowed — which
 * is exactly what the cross-tenant desk needs. Idempotent and re-runnable.
 */
export class SupportTicketsRls1782700000003 implements MigrationInterface {
  name = 'SupportTicketsRls1782700000003';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT unnest(ARRAY['support_tickets', 'support_ticket_messages']) AS table_name
        LOOP
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = r.table_name) THEN
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
          END IF;
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
          SELECT unnest(ARRAY['support_tickets', 'support_ticket_messages']) AS table_name
        LOOP
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = r.table_name) THEN
            EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.table_name);
            EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', r.table_name);
            EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', r.table_name);
          END IF;
        END LOOP;
      END $$;
    `);
  }
}
