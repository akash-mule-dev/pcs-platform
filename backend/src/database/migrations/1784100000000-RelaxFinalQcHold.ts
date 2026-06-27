import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Relax the default FINAL QC release gate from a HOLD point to a plain release
 * gate.
 *
 * The auto-appended `Final QC` stage used to be created as
 * `is_final_qc = true` + `inspection_type = 'hold'` + `requires_inspection =
 * true`, which forced a positive inspection to be recorded before the terminal
 * stage could complete — even for a clean piece with no NCRs. The product
 * decision is that the release gate should still BLOCK on open NCRs / unsigned
 * failed inspections (those checks key on `is_final_qc` and remain), but should
 * NOT demand a mandatory inspection (the hold-point semantics).
 *
 * This backfills every existing release gate (`is_final_qc = true`) that is
 * currently a hold point, clearing the hold so it matches the new default
 * (`library-content.ts#FINAL_QC_STAGE`). It deliberately leaves NON-final hold
 * points untouched — an in-process ITP hold a user set on, say, a Welding stage
 * stays a hold point. A process that wants its final QC to remain a hold can
 * re-flag the stage `inspection_type = 'hold'`.
 *
 * Idempotent and safe to run alongside `synchronize` (in dev, `synchronize` is
 * on and `migrationsRun` is off, so this runs only in prod/migration mode — the
 * dev DB is backfilled out-of-band; this guarantees prod parity).
 */
export class RelaxFinalQcHold1784100000000 implements MigrationInterface {
  name = 'RelaxFinalQcHold1784100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "stages"
         SET "inspection_type" = NULL,
             "requires_inspection" = false
       WHERE "is_final_qc" = true
         AND ("inspection_type" = 'hold' OR "requires_inspection" = true)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Best-effort reverse: restore the prior hold-point default on release gates.
    await q.query(`
      UPDATE "stages"
         SET "inspection_type" = 'hold',
             "requires_inspection" = true
       WHERE "is_final_qc" = true
         AND "inspection_type" IS NULL
    `);
  }
}
