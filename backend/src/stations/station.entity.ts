import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Line } from '../lines/line.entity.js';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';
import { numericTransformer } from '../common/transformers/numeric.transformer.js';

@Entity('stations')
@Unique(['name', 'lineId'])
export class Station extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

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

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
