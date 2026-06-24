import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Process } from '../processes/process.entity.js';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';
import { numericTransformer } from '../common/transformers/numeric.transformer.js';

@Entity('stages')
@Unique(['processId', 'sequence'])
export class Stage extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'process_id', type: 'uuid' })
  processId: string;

  @ManyToOne(() => Process, (p) => p.stages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'process_id' })
  process: Process;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'integer' })
  sequence: number;

  @Column({ name: 'target_time_seconds', type: 'integer' })
  targetTimeSeconds: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * Hold point: when true, the quality gate additionally requires at least one
   * acceptable inspection on the assembly before this stage can be completed
   * (see work-orders/qc-gate.ts). Meaningful on quality stages. Legacy flag —
   * `inspectionType = 'hold'` is the richer ITP expression and takes precedence.
   */
  @Column({ name: 'requires_inspection', type: 'boolean', default: false })
  requiresInspection: boolean;

  /**
   * ITP (Inspection & Test Plan) intent for this routing stage:
   *   hold    — work stops; an acceptable inspection must exist to complete (blocks, = a hold point);
   *   witness — customer/3rd-party may attend; advisory, does NOT block completion;
   *   review  — document review point; advisory, does NOT block;
   *   null    — not an inspection point.
   * The ITP for a Process is the ordered list of its stages where this is non-null.
   */
  @Column({ name: 'inspection_type', type: 'varchar', length: 16, nullable: true })
  inspectionType: 'hold' | 'witness' | 'review' | null;

  /**
   * Marks THIS stage as the terminal FINAL QC / release gate of the routing —
   * the consolidation point that cannot complete while the assembly has ANY open
   * NCR (raised at any stage) or unsigned failed inspection, and whose completion
   * releases the piece for shipping. Distinct from a per-stage hold point
   * (`inspectionType='hold'`), which gates only on its OWN stage's NCRs.
   *
   * Tri-state on purpose:
   *   true  — explicitly the final QC gate (set on the auto-appended stage);
   *   false — explicitly NOT a gate (suppresses the legacy name heuristic);
   *   null  — unknown/legacy → fall back to the `isQualityStageName` name match
   *           (see work-orders/qc-gate.ts → isFinalQcStage), so pre-existing
   *           "Quality Check" stages keep gating exactly as before.
   */
  @Column({ name: 'is_final_qc', type: 'boolean', nullable: true })
  isFinalQc: boolean | null;

  /** ITP line detail: what to verify + acceptance criteria (free-form, e.g. "AWS D1.1 visual weld"). */
  @Column({ name: 'inspection_characteristics', type: 'jsonb', nullable: true })
  inspectionCharacteristics: Record<string, any> | null;

  /** Optional role that must sign this inspection point (e.g. "cwi", "qa_manager"). Advisory metadata. */
  @Column({ name: 'required_signoff_role', type: 'varchar', length: 60, nullable: true })
  requiredSignoffRole: string | null;

  /**
   * Costing: standard labor rate for work at THIS stage (currency/hour), e.g.
   * welding ≠ painting. Used when the clocked worker has no personal rate;
   * unset/0 falls through to the org default (costing settings).
   */
  @Column({ name: 'hourly_rate', type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: numericTransformer })
  hourlyRate: number | null;

  /**
   * Costing (machine estimate): planned machine/work-center seconds PER UNIT at
   * this stage — e.g. laser cut time, brake cycle. Estimate machine cost =
   * machine_time_seconds × units × machine_rate; the earned-standard proxy uses
   * it for board-recorded stages with no clocked station time. 0 = no machine.
   */
  @Column({ name: 'machine_time_seconds', type: 'integer', default: 0 })
  machineTimeSeconds: number;

  /**
   * Costing: standard machine rate for this stage (currency/hour) — the planned
   * work-center burden used by the machine ESTIMATE + the board proxy. Actual
   * machine cost uses the real station's rate. Unset/0 = no machine cost.
   */
  @Column({ name: 'machine_rate', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  machineRate: number | null;

  /**
   * Costing: overhead/burden applied on THIS stage's labor, in percent (shop
   * burden differs by operation — welding ≠ painting). NULL = use the org
   * default (costing settings); 0 = explicitly no overhead for this stage.
   */
  @Column({ name: 'overhead_percent', type: 'numeric', precision: 6, scale: 2, nullable: true, transformer: numericTransformer })
  overheadPercent: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
