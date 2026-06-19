import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';

/**
 * Append-only NCR activity log — the audit trail + discussion thread for an
 * `ncr`-type QualityReport (raise, status change, disposition, comment, close,
 * reopen, cancel, re-inspection). Mirrors the retired `ncr_events` idea, but
 * scoped to a quality_reports row. ISO 9001 §8.7.2 wants the nonconformity, the
 * actions taken, any concession and the deciding authority retained — this is
 * where the "actions taken / by whom / when" history lives.
 */
@Entity('quality_report_events')
@Index(['organizationId', 'reportId'])
export class QualityReportEvent extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'report_id', type: 'uuid' }) reportId: string;

  /** created | submitted | status | disposition | comment | resolved | reopened | cancelled | reinspection */
  @Column({ type: 'varchar', length: 24 }) type: string;

  @Column({ name: 'from_status', type: 'varchar', length: 24, nullable: true }) fromStatus: string | null;
  @Column({ name: 'to_status', type: 'varchar', length: 24, nullable: true }) toStatus: string | null;
  @Column({ type: 'varchar', length: 24, nullable: true }) disposition: string | null;
  @Column({ type: 'text', nullable: true }) note: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
