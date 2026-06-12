import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';

export enum NcrStatus { OPEN = 'open', INVESTIGATION = 'investigation', DISPOSITION = 'disposition', CLOSED = 'closed', CANCELLED = 'cancelled' }
export enum NcrSeverity { LOW = 'low', MEDIUM = 'medium', HIGH = 'high', CRITICAL = 'critical' }
export enum NcrDisposition { REWORK = 'rework', SCRAP = 'scrap', USE_AS_IS = 'use_as_is', RETURN_TO_SUPPLIER = 'return_to_supplier', REGRADE = 'regrade' }

/** Non-Conformance Report — captured against a configurable template (per tenant). */
@Entity('ncrs')
@Index(['organizationId', 'status'])
export class Ncr extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 50 }) number: string; // NCR-YYYY-NNNN
  @Column({ type: 'varchar', length: 255 }) title: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'enum', enum: NcrStatus, default: NcrStatus.OPEN }) status: NcrStatus;
  @Column({ type: 'enum', enum: NcrSeverity, default: NcrSeverity.MEDIUM }) severity: NcrSeverity;

  @Column({ name: 'work_order_id', type: 'uuid', nullable: true }) workOrderId: string | null;
  @Column({ name: 'material_id', type: 'uuid', nullable: true }) materialId: string | null;
  @Column({ name: 'serial_id', type: 'uuid', nullable: true }) serialId: string | null;

  // Fabrication linkage
  @Column({ name: 'assembly_node_id', type: 'uuid', nullable: true }) assemblyNodeId: string | null;
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId: string | null;
  @Column({ name: 'quality_data_id', type: 'uuid', nullable: true }) qualityDataId: string | null;

  @Column({ name: 'template_id', type: 'uuid', nullable: true }) templateId: string | null;
  @Column({ name: 'data_json', type: 'jsonb', nullable: true }) dataJson: Record<string, any> | null;

  @Column({ name: 'raised_by', type: 'uuid', nullable: true }) raisedBy: string | null;
  @Column({ name: 'assigned_to', type: 'uuid', nullable: true }) assignedTo: string | null;
  @Column({ type: 'enum', enum: NcrDisposition, nullable: true }) disposition: NcrDisposition | null;
  @Column({ name: 'disposition_note', type: 'text', nullable: true }) dispositionNote: string | null;
  @Column({ name: 'closed_at', type: 'timestamp', nullable: true }) closedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
