import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage audit trail: `work_order_stages.updated_at` (the "status updated"
 * stamp) + the immutable `work_order_stage_events` history table (who moved
 * what stage, when, from where). Idempotent — safe to run on databases that
 * already received these objects via synchronize.
 */
export class StageAuditTrail1782100000000 implements MigrationInterface {
  name = 'StageAuditTrail1782100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "work_order_stages"
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP NOT NULL DEFAULT now()
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "work_order_stage_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid,
        "work_order_stage_id" uuid NOT NULL,
        "work_order_id" uuid NOT NULL,
        "production_order_id" uuid,
        "assembly_node_id" uuid,
        "stage_name" varchar(120),
        "user_id" uuid,
        "action" varchar(20) NOT NULL,
        "from_status" varchar(20),
        "to_status" varchar(20),
        "from_qty" integer,
        "to_qty" integer,
        "source" varchar(10) NOT NULL DEFAULT 'web',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_work_order_stage_events" PRIMARY KEY ("id")
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wos_events_order_created"
        ON "work_order_stage_events" ("production_order_id", "created_at")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wos_events_node_created"
        ON "work_order_stage_events" ("assembly_node_id", "created_at")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "work_order_stage_events"`);
    await q.query(`ALTER TABLE "work_order_stages" DROP COLUMN IF EXISTS "updated_at"`);
  }
}
