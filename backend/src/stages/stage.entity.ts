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
   * (see work-orders/qc-gate.ts). Meaningful on quality stages.
   */
  @Column({ name: 'requires_inspection', type: 'boolean', default: false })
  requiresInspection: boolean;

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
