import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Line } from '../lines/line.entity.js';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';
import { numericTransformer } from '../common/transformers/numeric.transformer.js';

/** The kind of work-center — drives the directory's "type" filter and the floor icon. */
export enum StationType {
  LASER = 'laser',
  SAW = 'saw',
  DRILL = 'drill',
  FIT_UP = 'fit_up',
  WELD = 'weld',
  BLAST = 'blast',
  PAINT = 'paint',
  QC = 'qc',
  OTHER = 'other',
}

/**
 * Operational state a supervisor/operator sets (the `stations.operate` action).
 * Distinct from the LIVE busy/idle flag derived from open time entries: `busy`
 * is "someone is clocked in right now"; `status` is the planned/declared state
 * (e.g. a machine flagged `down` is unavailable even if no one is clocked in).
 */
export enum StationStatus {
  AVAILABLE = 'available',
  RUNNING = 'running',
  IDLE = 'idle',
  SETUP = 'setup',
  DOWN = 'down',
  MAINTENANCE = 'maintenance',
  OFFLINE = 'offline',
}

/** Statuses that mean the work-center cannot accept work right now. */
export const UNAVAILABLE_STATION_STATUSES: ReadonlySet<StationStatus> = new Set([
  StationStatus.DOWN,
  StationStatus.MAINTENANCE,
  StationStatus.OFFLINE,
]);

@Entity('stations')
@Unique(['name', 'lineId'])
export class Station extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** Optional work-center code (e.g. "WELD-3"). Unique per organization when set (enforced in the service). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  code: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: StationType, default: StationType.OTHER })
  type: StationType;

  @Column({ type: 'enum', enum: StationStatus, default: StationStatus.AVAILABLE })
  status: StationStatus;

  @Column({ name: 'line_id', type: 'uuid' })
  lineId: string;

  @ManyToOne(() => Line, (l) => l.stations)
  @JoinColumn({ name: 'line_id' })
  line: Line;

  /**
   * Costing: machine/work-center burden rate (currency/hour) — depreciation +
   * power + maintenance + consumables for running this work-center for an hour.
   * Charged on attended station time (costing reads this; the org has no machine
   * default — an unrated station simply incurs no machine cost). Frozen onto
   * time_entries.machine_rate at clock-out.
   */
  @Column({ name: 'machine_rate', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  machineRate: number | null;

  /**
   * Capacity basis: the hours/day this work-center is staffed. The utilization
   * denominator — `available hours = availableHoursPerDay × days in the window`.
   * Null means utilization % is not reported (raw attended hours only).
   */
  @Column({ name: 'available_hours_per_day', type: 'numeric', precision: 6, scale: 2, nullable: true, transformer: numericTransformer })
  availableHoursPerDay: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
