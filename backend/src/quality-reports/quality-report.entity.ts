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
@Index(['organizationId', 'assemblyNodeId'])
@Index(['organizationId', 'number'], { unique: true })
export class QualityReport extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  /** QR-YYYY-NNNN — sequence per organization, allocated from the MAX existing suffix. */
  @Column({ type: 'varchar', length: 50 }) number: string;

  // Template snapshot
  @Column({ name: 'template_id', type: 'uuid', nullable: true }) templateId: string | null;
  @Column({ name: 'template_name', type: 'varchar', length: 255 }) templateName: string;
  /**
   * Snapshot of the template's `type` at creation (inspection | checklist | ncr |
   * capa | other). A report whose `templateType === 'ncr'` IS a non-conformance
   * report: it blocks the shipping + quality-stage gates while unresolved.
   */
  @Column({ name: 'template_type', type: 'varchar', length: 40, nullable: true }) templateType: string | null;
  @Column({ name: 'template_schema', type: 'jsonb' }) templateSchema: Record<string, any>;

  // What the report is about
  @Column({ name: 'production_order_id', type: 'uuid' }) productionOrderId: string;
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId: string | null;
  @Column({ name: 'assembly_node_id', type: 'uuid', nullable: true }) assemblyNodeId: string | null;

  /**
   * When this report (an NCR) was raised FROM a failed inspection, the source
   * `quality_data` row — the §8.7 audit link between the detected nonconformity
   * and its formal record. Null for reports created directly from a template.
   */
  @Column({ name: 'source_quality_data_id', type: 'uuid', nullable: true }) sourceQualityDataId: string | null;

  // The filled form
  @Column({ type: 'jsonb', nullable: true }) data: Record<string, any> | null;
  @Column({ type: 'enum', enum: QualityReportStatus, default: QualityReportStatus.DRAFT })
  status: QualityReportStatus;

  @Column({ name: 'filled_by', type: 'uuid', nullable: true }) filledBy: string | null;
  @Column({ name: 'submitted_at', type: 'timestamp', nullable: true }) submittedAt: Date | null;

  /**
   * NCR lifecycle (only meaningful for `ncr`-type reports). The GATE is keyed on
   * `resolvedAt IS NULL` (unchanged): an NCR blocks shipping + quality-stage
   * completion until it is CLOSED or CANCELLED, both of which stamp `resolvedAt`.
   * `ncrStatus` carries the richer state for the UI/timeline:
   *   open → under_review → dispositioned → closed   (+ cancelled, + reopen).
   */
  @Column({ name: 'ncr_status', type: 'varchar', length: 24, nullable: true }) ncrStatus: string | null;

  /** Material Review disposition: rework | repair | use_as_is | scrap | return_to_supplier. */
  @Column({ name: 'disposition', type: 'varchar', length: 24, nullable: true }) disposition: string | null;
  @Column({ name: 'disposition_notes', type: 'text', nullable: true }) dispositionNotes: string | null;
  @Column({ name: 'disposition_by', type: 'uuid', nullable: true }) dispositionBy: string | null;
  @Column({ name: 'disposition_at', type: 'timestamp', nullable: true }) dispositionAt: Date | null;

  /** Investigation outcome + the action taken (ISO 9001 §8.7.2 "actions taken"). */
  @Column({ name: 'root_cause', type: 'text', nullable: true }) rootCause: string | null;
  @Column({ name: 'corrective_action', type: 'text', nullable: true }) correctiveAction: string | null;

  /**
   * Concession authorization (ISO §8.7.1 c/d). `repair` and `use_as_is` accept a
   * deviation from spec and so require an authorized concession — captured here
   * and enforced before close by `assertCloseable`. `concessionBy` is the
   * authority; `concessionReason` is the justification on record.
   */
  @Column({ name: 'concession_by', type: 'uuid', nullable: true }) concessionBy: string | null;
  @Column({ name: 'concession_reason', type: 'text', nullable: true }) concessionReason: string | null;

  /**
   * NCR close: an `ncr`-type report is OPEN (blocks gates) while `resolvedAt` is
   * null; closing (or cancelling) stamps it. `resolvedBy` is the closing authority.
   */
  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true }) resolvedAt: Date | null;
  @Column({ name: 'resolved_by', type: 'uuid', nullable: true }) resolvedBy: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
