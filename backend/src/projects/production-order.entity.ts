import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Project } from './project.entity.js';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';

export enum ProductionOrderStatus {
  PLANNED = 'planned',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

/**
 * A production instance of a Project — UI label "Work Order". One project can
 * have many (e.g. the same design fabricated for different customers/runs).
 * Carries its OWN process + quantity; all stage progress is tracked per order.
 */
@Entity('production_orders')
@Index(['organizationId', 'projectId'])
export class ProductionOrder extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' }) project: Project;

  @Column({ type: 'varchar', length: 50, unique: true }) number: string; // ORD-YYYY-NNNN
  @Column({ name: 'customer_name', type: 'varchar', length: 255, nullable: true }) customerName: string | null;
  @Column({ type: 'integer', default: 1 }) quantity: number;

  @Column({ name: 'process_id', type: 'uuid', nullable: true }) processId: string | null;

  @Column({ type: 'enum', enum: ProductionOrderStatus, default: ProductionOrderStatus.PLANNED })
  status: ProductionOrderStatus;

  @Column({ name: 'due_date', type: 'timestamp', nullable: true }) dueDate: Date | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
