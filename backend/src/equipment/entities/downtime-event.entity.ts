import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';
import { numericTransformer } from '../../common/transformers/numeric.transformer.js';
import { Equipment } from './equipment.entity.js';

export enum DowntimeReason {
  BREAKDOWN = 'breakdown', CHANGEOVER = 'changeover', NO_MATERIAL = 'no_material',
  NO_OPERATOR = 'no_operator', PLANNED_MAINTENANCE = 'planned_maintenance', QUALITY = 'quality', OTHER = 'other',
}

/** A period a machine was down. end_time null = currently down. */
@Entity('downtime_events')
@Index(['organizationId', 'equipmentId'])
export class DowntimeEvent extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'equipment_id', type: 'uuid' }) equipmentId: string;
  @ManyToOne(() => Equipment, { eager: true }) @JoinColumn({ name: 'equipment_id' }) equipment: Equipment;
  @Column({ type: 'enum', enum: DowntimeReason, default: DowntimeReason.OTHER }) reason: DowntimeReason;
  @Column({ name: 'start_time', type: 'timestamp' }) startTime: Date;
  @Column({ name: 'end_time', type: 'timestamp', nullable: true }) endTime: Date | null;
  @Column({ name: 'duration_seconds', type: 'numeric', precision: 12, scale: 0, nullable: true, transformer: numericTransformer }) durationSeconds: number | null;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
