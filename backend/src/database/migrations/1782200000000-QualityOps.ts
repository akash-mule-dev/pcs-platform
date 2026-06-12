import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quality workflow operations hardening. Idempotent.
 *
 *  - stages.requires_inspection — inspection hold-point flag per stage.
 *  - ncrs: dispositioned_at (rework re-inspections must postdate it),
 *    attachments (NCR photo evidence), version (optimistic concurrency).
 *  - quality_data.client_key + unique (org, client_key) — idempotent creates
 *    for offline/replayed mobile captures.
 */
export class QualityOps1782200000000 implements MigrationInterface {
  name = 'QualityOps1782200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "requires_inspection" boolean NOT NULL DEFAULT false`);

    await q.query(`ALTER TABLE "ncrs" ADD COLUMN IF NOT EXISTS "dispositioned_at" TIMESTAMP`);
    await q.query(`ALTER TABLE "ncrs" ADD COLUMN IF NOT EXISTS "attachments" jsonb`);
    await q.query(`ALTER TABLE "ncrs" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1`);
    // Backfill: rows that already carry a disposition treat their last update as the decision time.
    await q.query(`UPDATE "ncrs" SET "dispositioned_at" = "updated_at" WHERE "disposition" IS NOT NULL AND "dispositioned_at" IS NULL`);

    await q.query(`ALTER TABLE "quality_data" ADD COLUMN IF NOT EXISTS "client_key" uuid`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_quality_data_org_client_key" ON "quality_data" ("organization_id", "client_key")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_quality_data_org_client_key"`);
    await q.query(`ALTER TABLE "quality_data" DROP COLUMN IF EXISTS "client_key"`);
    await q.query(`ALTER TABLE "ncrs" DROP COLUMN IF EXISTS "version"`);
    await q.query(`ALTER TABLE "ncrs" DROP COLUMN IF EXISTS "attachments"`);
    await q.query(`ALTER TABLE "ncrs" DROP COLUMN IF EXISTS "dispositioned_at"`);
    await q.query(`ALTER TABLE "stages" DROP COLUMN IF EXISTS "requires_inspection"`);
  }
}
