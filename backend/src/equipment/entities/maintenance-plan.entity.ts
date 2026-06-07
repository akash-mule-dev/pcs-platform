import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';
import { Equipment } from './equipment.entity.js';

/** Preventive-maintenance schedule for a machine (per tenant). */
@Entity('maintenance_plans')
@Index(['organizationId', 'equipmentId'])
export class MaintenancePlan extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'equipment_id', type: 'uuid' }) equipmentId: string;
  @ManyToOne(() => Equipment, { eager: true }) @JoinColumn({ name: 'equipment_id' }) equipment: Equipment;
  @Column({ type: 'varchar', length: 255 }) name: string;
  @Column({ name: 'interval_days', type: 'integer', default: 30 }) intervalDays: number;
  @Column({ name: 'last_done_at', type: 'timestamp', nullable: true }) lastDoneAt: Date | null;
  @Column({ name: 'next_due_at', type: 'timestamp', nullable: true }) nextDueAt: Date | null;
  @Column({ type: 'text', nullable: true }) instructions: string | null;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
