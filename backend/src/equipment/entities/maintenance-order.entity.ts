import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';
import { Equipment } from './equipment.entity.js';

export enum MaintenanceOrderStatus { OPEN = 'open', IN_PROGRESS = 'in_progress', DONE = 'done', CANCELLED = 'cancelled' }

/** A scheduled or ad-hoc maintenance job on a machine (per tenant). */
@Entity('maintenance_orders')
@Index(['organizationId', 'equipmentId'])
export class MaintenanceOrder extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'equipment_id', type: 'uuid' }) equipmentId: string;
  @ManyToOne(() => Equipment, { eager: true }) @JoinColumn({ name: 'equipment_id' }) equipment: Equipment;
  @Column({ name: 'plan_id', type: 'uuid', nullable: true }) planId: string | null;
  @Column({ type: 'enum', enum: MaintenanceOrderStatus, default: MaintenanceOrderStatus.OPEN }) status: MaintenanceOrderStatus;
  @Column({ name: 'scheduled_for', type: 'timestamp', nullable: true }) scheduledFor: Date | null;
  @Column({ name: 'started_at', type: 'timestamp', nullable: true }) startedAt: Date | null;
  @Column({ name: 'completed_at', type: 'timestamp', nullable: true }) completedAt: Date | null;
  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true }) assignedUserId: string | null;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
