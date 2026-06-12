import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';

export enum CapaType { CORRECTIVE = 'corrective', PREVENTIVE = 'preventive' }
export enum CapaStatus { OPEN = 'open', IN_PROGRESS = 'in_progress', VERIFIED = 'verified', CLOSED = 'closed' }

/** Corrective / Preventive Action, optionally linked to an NCR (per tenant). */
@Entity('capas')
@Index(['organizationId', 'status'])
export class Capa extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'ncr_id', type: 'uuid', nullable: true }) ncrId: string | null;
  @Column({ type: 'varchar', length: 255 }) title: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'enum', enum: CapaType, default: CapaType.CORRECTIVE }) type: CapaType;
  @Column({ type: 'enum', enum: CapaStatus, default: CapaStatus.OPEN }) status: CapaStatus;
  @Column({ name: 'root_cause', type: 'text', nullable: true }) rootCause: string | null;
  @Column({ name: 'action_plan', type: 'text', nullable: true }) actionPlan: string | null;
  @Column({ type: 'uuid', nullable: true }) owner: string | null;
  @Column({ name: 'due_date', type: 'date', nullable: true }) dueDate: string | null;
  @Column({ name: 'verified_by', type: 'uuid', nullable: true }) verifiedBy: string | null;
  @Column({ name: 'verified_at', type: 'timestamp', nullable: true }) verifiedAt: Date | null;
  @Column({ name: 'closed_at', type: 'timestamp', nullable: true }) closedAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
