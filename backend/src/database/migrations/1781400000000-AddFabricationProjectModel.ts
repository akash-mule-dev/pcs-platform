import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fabrication project model — Phase 1 (schema).
 *
 * Creates the tables that turn an uploaded IFC/CAD/mesh file into a tracked,
 * shippable project:
 *   - projects        the job / contract container
 *   - import_files    uploaded source files + pipeline status
 *   - assembly_nodes  ONE self-referencing tree: assemblies, subassemblies, parts
 *   - shipments       shipping loads ("shipping list")
 *   - shipment_items  assemblies loaded on a shipment
 * and links the existing stage engine to it:
 *   - work_orders.assembly_node_id  (a work order can target an assembly node)
 *
 * Idempotent and safe to run alongside `synchronize`: every statement is guarded
 * (IF NOT EXISTS / pg_type / pg_constraint), and FK creation skips referenced
 * tables that don't exist yet. Mirrors the conventions in the existing
 * TenantFoundation / AddConversionDedupeAndDimensions migrations.
 */
export class AddFabricationProjectModel1781400000000 implements MigrationInterface {
  name = 'AddFabricationProjectModel1781400000000';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Enum types (TypeORM default naming: "<table>_<column>_enum").
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'projects_status_enum') THEN
          CREATE TYPE "projects_status_enum" AS ENUM ('planning','active','on_hold','completed','archived');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assembly_nodes_node_type_enum') THEN
          CREATE TYPE "assembly_nodes_node_type_enum" AS ENUM ('group','assembly','subassembly','part');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assembly_nodes_production_status_enum') THEN
          CREATE TYPE "assembly_nodes_production_status_enum" AS ENUM ('not_started','in_progress','ready_to_ship','shipped','on_hold');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_files_status_enum') THEN
          CREATE TYPE "import_files_status_enum" AS ENUM ('uploaded','converting','extracting','completed','failed');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shipments_status_enum') THEN
          CREATE TYPE "shipments_status_enum" AS ENUM ('planned','loaded','shipped','delivered','cancelled');
        END IF;
      END $$;
    `);

    // 2. Tables.
    await q.query(`
      CREATE TABLE IF NOT EXISTS "projects" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid,
        "name" character varying(255) NOT NULL,
        "project_number" character varying(100),
        "client_name" character varying(255),
        "description" text,
        "status" "projects_status_enum" NOT NULL DEFAULT 'planning',
        "due_date" TIMESTAMP,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_projects" PRIMARY KEY ("id")
      )
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "import_files" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid,
        "project_id" uuid NOT NULL,
        "original_name" character varying(255) NOT NULL,
        "format" character varying(20) NOT NULL,
        "storage_key" character varying(500),
        "size" integer,
        "status" "import_files_status_enum" NOT NULL DEFAULT 'uploaded',
        "conversion_job_id" uuid,
        "model_id" uuid,
        "node_count" integer NOT NULL DEFAULT 0,
        "error" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_import_files" PRIMARY KEY ("id")
      )
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "assembly_nodes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid,
        "project_id" uuid NOT NULL,
        "parent_id" uuid,
        "node_type" "assembly_nodes_node_type_enum" NOT NULL DEFAULT 'part',
        "name" character varying(255) NOT NULL,
        "mark" character varying(100),
        "quantity" integer NOT NULL DEFAULT 1,
        "ifc_guid" character varying(64),
        "ifc_class" character varying(64),
        "source_format" character varying(20),
        "import_file_id" uuid,
        "profile" character varying(120),
        "material_grade" character varying(60),
        "length_mm" numeric(12,2),
        "weight_kg" numeric(12,3),
        "properties" jsonb,
        "model_id" uuid,
        "mesh_name" character varying(255),
        "production_status" "assembly_nodes_production_status_enum" NOT NULL DEFAULT 'not_started',
        "current_stage_id" uuid,
        "percent_complete" numeric(5,2) NOT NULL DEFAULT 0,
        "qty_complete" integer NOT NULL DEFAULT 0,
        "qty_shipped" integer NOT NULL DEFAULT 0,
        "depth" integer NOT NULL DEFAULT 0,
        "sort_index" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_assembly_nodes" PRIMARY KEY ("id")
      )
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "shipments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid,
        "project_id" uuid NOT NULL,
        "shipment_number" character varying(50) NOT NULL,
        "status" "shipments_status_enum" NOT NULL DEFAULT 'planned',
        "destination" character varying(255),
        "carrier" character varying(255),
        "planned_date" TIMESTAMP,
        "shipped_at" TIMESTAMP,
        "notes" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shipments" PRIMARY KEY ("id")
      )
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "shipment_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid,
        "shipment_id" uuid NOT NULL,
        "assembly_node_id" uuid NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shipment_items" PRIMARY KEY ("id")
      )
    `);

    // 3. Link the existing stage engine: work_orders.assembly_node_id.
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_orders') THEN
          ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "assembly_node_id" uuid;
        END IF;
      END $$;
    `);

    // 4. Indexes (match the entity @Index sets).
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_projects_org_number" ON "projects" ("organization_id","project_number")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_import_files_org_project" ON "import_files" ("organization_id","project_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_assembly_nodes_org_project" ON "assembly_nodes" ("organization_id","project_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_assembly_nodes_org_parent" ON "assembly_nodes" ("organization_id","parent_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_assembly_nodes_org_project_mark" ON "assembly_nodes" ("organization_id","project_id","mark")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_assembly_nodes_org_project_guid" ON "assembly_nodes" ("organization_id","project_id","ifc_guid")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_shipments_org_project" ON "shipments" ("organization_id","project_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_shipment_items_org_shipment" ON "shipment_items" ("organization_id","shipment_id")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_work_orders_assembly_node" ON "work_orders" ("assembly_node_id")`);

    // 5. Foreign keys (guarded: skip if already present or referenced table absent).
    await this.addFk(q, 'import_files', 'FK_import_files_project', 'project_id', 'projects', 'id', 'CASCADE');
    await this.addFk(q, 'assembly_nodes', 'FK_assembly_nodes_project', 'project_id', 'projects', 'id', 'CASCADE');
    await this.addFk(q, 'assembly_nodes', 'FK_assembly_nodes_parent', 'parent_id', 'assembly_nodes', 'id', 'CASCADE');
    await this.addFk(q, 'assembly_nodes', 'FK_assembly_nodes_import_file', 'import_file_id', 'import_files', 'id', 'SET NULL');
    await this.addFk(q, 'assembly_nodes', 'FK_assembly_nodes_model', 'model_id', 'models', 'id', 'SET NULL');
    await this.addFk(q, 'assembly_nodes', 'FK_assembly_nodes_stage', 'current_stage_id', 'stages', 'id', 'SET NULL');
    await this.addFk(q, 'shipments', 'FK_shipments_project', 'project_id', 'projects', 'id', 'CASCADE');
    await this.addFk(q, 'shipment_items', 'FK_shipment_items_shipment', 'shipment_id', 'shipments', 'id', 'CASCADE');
    await this.addFk(q, 'shipment_items', 'FK_shipment_items_node', 'assembly_node_id', 'assembly_nodes', 'id', 'CASCADE');
    await this.addFk(q, 'work_orders', 'FK_work_orders_assembly_node', 'assembly_node_id', 'assembly_nodes', 'id', 'SET NULL');
  }

  /** Add a FK only if both tables exist and the constraint isn't already there. */
  private async addFk(
    q: QueryRunner,
    table: string,
    name: string,
    col: string,
    refTable: string,
    refCol: string,
    onDelete: string,
  ): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '${table}')
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '${refTable}')
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
          ALTER TABLE "${table}" ADD CONSTRAINT "${name}"
            FOREIGN KEY ("${col}") REFERENCES "${refTable}"("${refCol}") ON DELETE ${onDelete};
        END IF;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE IF EXISTS "work_orders" DROP CONSTRAINT IF EXISTS "FK_work_orders_assembly_node"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_work_orders_assembly_node"`);
    await q.query(`ALTER TABLE IF EXISTS "work_orders" DROP COLUMN IF EXISTS "assembly_node_id"`);

    await q.query(`DROP TABLE IF EXISTS "shipment_items"`);
    await q.query(`DROP TABLE IF EXISTS "shipments"`);
    await q.query(`DROP TABLE IF EXISTS "assembly_nodes"`);
    await q.query(`DROP TABLE IF EXISTS "import_files"`);
    await q.query(`DROP TABLE IF EXISTS "projects"`);

    await q.query(`DROP TYPE IF EXISTS "shipments_status_enum"`);
    await q.query(`DROP TYPE IF EXISTS "import_files_status_enum"`);
    await q.query(`DROP TYPE IF EXISTS "assembly_nodes_production_status_enum"`);
    await q.query(`DROP TYPE IF EXISTS "assembly_nodes_node_type_enum"`);
    await q.query(`DROP TYPE IF EXISTS "projects_status_enum"`);
  }
}
