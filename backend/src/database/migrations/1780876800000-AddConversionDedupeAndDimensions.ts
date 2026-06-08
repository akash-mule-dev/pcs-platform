import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Formalizes the columns added for the conversion pipeline that were previously
 * created implicitly by `synchronize`:
 *   - conversion_jobs.source_hash  (sha256(file+options) for dedupe) + index
 *   - conversion_jobs.dimensions   (real-world bounding box, metres, jsonb)
 *
 * Idempotent: each statement is guarded, and the whole thing no-ops if the
 * conversion_jobs table does not exist yet (e.g. a from-scratch DB that will be
 * baselined by `npm run migration:generate`).
 */
export class AddConversionDedupeAndDimensions1780876800000 implements MigrationInterface {
  name = 'AddConversionDedupeAndDimensions1780876800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversion_jobs') THEN
          ALTER TABLE "conversion_jobs" ADD COLUMN IF NOT EXISTS "source_hash" character varying(80);
          ALTER TABLE "conversion_jobs" ADD COLUMN IF NOT EXISTS "dimensions" jsonb;
          CREATE INDEX IF NOT EXISTS "IDX_conversion_jobs_source_hash"
            ON "conversion_jobs" ("source_hash");
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_conversion_jobs_source_hash"`);
    await queryRunner.query(`ALTER TABLE "conversion_jobs" DROP COLUMN IF EXISTS "dimensions"`);
    await queryRunner.query(`ALTER TABLE "conversion_jobs" DROP COLUMN IF EXISTS "source_hash"`);
  }
}
