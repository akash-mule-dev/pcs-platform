import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer support: tickets (tenant-owned, globally numbered) + their
 * conversation messages (customer / support / system, internal-note flag).
 * Idempotent.
 */
export class SupportTickets1782200000000 implements MigrationInterface {
  name = 'SupportTickets1782200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "support_tickets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid,
        "number" varchar(30) NOT NULL,
        "subject" varchar(200) NOT NULL,
        "description" text NOT NULL,
        "category" varchar(30) NOT NULL DEFAULT 'other',
        "priority" varchar(20) NOT NULL DEFAULT 'normal',
        "status" varchar(20) NOT NULL DEFAULT 'open',
        "raised_by_user_id" uuid,
        "raised_by_name" varchar(200),
        "raised_by_email" varchar(255),
        "assigned_to_user_id" uuid,
        "assigned_to_name" varchar(200),
        "context_url" varchar(500),
        "app_version" varchar(50),
        "last_message_at" TIMESTAMP,
        "first_response_at" TIMESTAMP,
        "resolved_at" TIMESTAMP,
        "closed_at" TIMESTAMP,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_support_tickets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_support_tickets_number" UNIQUE ("number")
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_support_tickets_org_status" ON "support_tickets" ("organization_id", "status")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_support_tickets_assignee" ON "support_tickets" ("assigned_to_user_id")`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "support_ticket_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid,
        "ticket_id" uuid NOT NULL,
        "author_user_id" uuid,
        "author_name" varchar(200),
        "author_kind" varchar(20) NOT NULL DEFAULT 'customer',
        "body" text NOT NULL,
        "internal" boolean NOT NULL DEFAULT false,
        "attachments" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_support_ticket_messages" PRIMARY KEY ("id")
      )
    `);
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_support_messages_ticket') THEN
          ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "FK_support_messages_ticket"
            FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_support_messages_ticket" ON "support_ticket_messages" ("ticket_id")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "support_ticket_messages"`);
    await q.query(`DROP TABLE IF EXISTS "support_tickets"`);
  }
}
