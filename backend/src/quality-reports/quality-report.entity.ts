import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';

export enum QualityReportStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
}

/**
 * A filled (or being-filled) QC report: one instance of a FormTemplate raised
 * against a production work order (and optionally one item of it).
 *
 * The template's name + schema are SNAPSHOTTED at creation, so editing or
 * deleting a template never breaks reports that were filled against it.
 */
@Entity('quality_reports')
@Index(['organizationId', 'productionOrderId'])
@Index(['organizationId', 'status'])
export class QualityReport extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  /** QR-YYYY-NNNN — allocated from the MAX existing suffix. */
  @Column({ type: 'varchar', length: 50, unique: true }) number: string;

  // Template snapshot
  @Column({ name: 'template_id', type: 'uuid', nullable: true }) templateId: string | null;
  @Column({ name: 'template_name', type: 'varchar', length: 255 }) templateName: string;
  @Column({ name: 'template_schema', type: 'jsonb' }) templateSchema: Record<string, any>;

  // What the report is about
  @Column({ name: 'production_order_id', type: 'uuid' }) productionOrderId: string;
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId: string | null;
  @Column({ name: 'assembly_node_id', type: 'uuid', nullable: true }) assemblyNodeId: string | null;

  // The filled form
  @Column({ type: 'jsonb', nullable: true }) data: Record<string, any> | null;
  @Column({ type: 'enum', enum: QualityReportStatus, default: QualityReportStatus.DRAFT })
  status: QualityReportStatus;

  @Column({ name: 'filled_by', type: 'uuid', nullable: true }) filledBy: string | null;
  @Column({ name: 'submitted_at', type: 'timestamp', nullable: true }) submittedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
