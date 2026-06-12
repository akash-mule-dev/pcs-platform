import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';

export enum NcrEventType {
  CREATED = 'created',
  STATUS_CHANGE = 'status_change',
  DISPOSITION = 'disposition',
  ASSIGNMENT = 'assignment',
  COMMENT = 'comment',
}

/**
 * Append-only NCR timeline: who did what, when. One row per lifecycle action
 * (creation, status changes, disposition decisions, assignments, comments) —
 * this is the audit trail the NCR detail views render.
 */
@Entity('ncr_events')
@Index(['organizationId', 'ncrId'])
export class NcrEvent extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column({ name: 'ncr_id', type: 'uuid' }) ncrId: string;

  @Column({ type: 'enum', enum: NcrEventType }) type: NcrEventType;

  @Column({ name: 'from_status', type: 'varchar', length: 30, nullable: true }) fromStatus: string | null;
  @Column({ name: 'to_status', type: 'varchar', length: 30, nullable: true }) toStatus: string | null;

  /** Free text: comment body, disposition note, assignment target label, … */
  @Column({ type: 'text', nullable: true }) note: string | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true }) actorUserId: string | null;
  /** Display name snapshot so the timeline survives user renames/removals. */
  @Column({ name: 'actor_name', type: 'varchar', length: 200, nullable: true }) actorName: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
