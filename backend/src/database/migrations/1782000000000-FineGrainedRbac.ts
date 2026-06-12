import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fine-grained RBAC:
 *  - roles become org-scoped (custom roles) with immutable built-in system roles
 *  - role_permission_grants holds `<feature>.<action>` permissions of custom roles
 *    (system role permissions come from the code catalog: rbac/permission-catalog.ts)
 *  - the legacy `role_permissions` per-tenant override table is superseded (kept
 *    in place — no destructive change — but no longer read by the app).
 * Idempotent.
 */
export class FineGrainedRbac1782000000000 implements MigrationInterface {
  name = 'FineGrainedRbac1782000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "organization_id" uuid`);
    await q.query(`ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "is_system" boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP NOT NULL DEFAULT now()`);

    // The global unique on roles.name gives way to: unique among system roles
    // (org IS NULL) + unique per organization for custom roles.
    await q.query(`
      DO $$
      DECLARE c record;
      BEGIN
        FOR c IN
          SELECT con.conname FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname = 'roles' AND con.contype = 'u'
        LOOP
          EXECUTE format('ALTER TABLE "roles" DROP CONSTRAINT %I', c.conname);
        END LOOP;
      END $$;
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_roles_system_name" ON "roles" ("name") WHERE "organization_id" IS NULL`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_roles_org_name" ON "roles" ("organization_id", "name") WHERE "organization_id" IS NOT NULL`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_roles_organization_id" ON "roles" ("organization_id")`);

    // Flag the built-in roles (created by earlier seeds) as system roles.
    await q.query(`
      UPDATE "roles" SET "is_system" = true
      WHERE "organization_id" IS NULL
        AND "name" IN ('admin', 'manager', 'supervisor', 'operator')
        AND "is_system" = false
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "role_permission_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "role_id" uuid NOT NULL,
        "permission" varchar(100) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_role_permission_grants" PRIMARY KEY ("id")
      )
    `);
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_role_permission_grants_role') THEN
          ALTER TABLE "role_permission_grants" ADD CONSTRAINT "FK_role_permission_grants_role"
            FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_role_permission_grant" ON "role_permission_grants" ("role_id", "permission")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_role_permission_grants_role_id" ON "role_permission_grants" ("role_id")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "role_permission_grants"`);
    await q.query(`DROP INDEX IF EXISTS "uq_roles_system_name"`);
    await q.query(`DROP INDEX IF EXISTS "uq_roles_org_name"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_roles_organization_id"`);
    await q.query(`ALTER TABLE "roles" DROP COLUMN IF EXISTS "is_system"`);
    await q.query(`ALTER TABLE "roles" DROP COLUMN IF EXISTS "organization_id"`);
  }
}
