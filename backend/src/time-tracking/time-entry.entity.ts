import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../auth/entities/user.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { Station } from '../stations/station.entity.js';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';
import { numericTransformer } from '../common/transformers/numeric.transformer.js';

export enum InputMethod {
  WEB = 'web',
  MOBILE = 'mobile',
  BADGE = 'badge',
  KIOSK = 'kiosk',
}

@Entity('time_entries')
export class TimeEntry extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'work_order_stage_id', type: 'uuid' })
  workOrderStageId: string;

  @ManyToOne(() => WorkOrderStage, { eager: true })
  @JoinColumn({ name: 'work_order_stage_id' })
  workOrderStage: WorkOrderStage;

  @Column({ name: 'station_id', type: 'uuid', nullable: true })
  stationId: string | null;

  @ManyToOne(() => Station, { nullable: true, eager: true })
  @JoinColumn({ name: 'station_id' })
  station: Station | null;

  @Column({ name: 'start_time', type: 'timestamp' })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamp', nullable: true })
  endTime: Date | null;

  @Column({ name: 'duration_seconds', type: 'integer', nullable: true })
  durationSeconds: number | null;

  @Column({ name: 'break_seconds', type: 'integer', default: 0 })
  breakSeconds: number;

  @Column({ name: 'idle_seconds', type: 'integer', default: 0 })
  idleSeconds: number;

  @Column({ name: 'input_method', type: 'enum', enum: InputMethod, default: InputMethod.WEB })
  inputMethod: InputMethod;

  @Column({ name: 'is_rework', type: 'boolean', default: false })
  isRework: boolean;

  /**
   * Setup time (machine/fixture set-up, first-off) vs run time. Costing splits
   * labor into setup / run / rework buckets; setup is a fixed batch cost.
   */
  @Column({ name: 'is_setup', type: 'boolean', default: false })
  isSetup: boolean;

  /**
   * Costing: the labor rate (currency/hour) RESOLVED + STAMPED at clock-out —
   * the worker's personal rate, else the stage standard rate (the org default is
   * NOT frozen here: it's a live fallback, applied at read time when this is
   * null). This freezes a deliberate rate at the moment work happened so a later
   * rate change never rewrites historical cost — the labor analog of
   * stock_movements.unit_cost. Costing reads COALESCE(labor_rate, live chain).
   */
  @Column({ name: 'labor_rate', type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: numericTransformer })
  laborRate: number | null;

  /**
   * Costing: the machine/work-center rate (currency/hour) of this entry's
   * station, FROZEN at clock-out (the machine analog of labor_rate). Costing
   * reads COALESCE(machine_rate, the station's live rate); null when the entry
   * had no station or the station has no rate.
   */
  @Column({ name: 'machine_rate', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  machineRate: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
