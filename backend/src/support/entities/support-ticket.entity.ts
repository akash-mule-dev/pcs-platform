import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, VersionColumn, Index, OneToMany,
} from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';
import { SupportTicketMessage } from './support-ticket-message.entity.js';

/**
 * A customer support ticket. Tenant-owned (the raising organization), but
 * managed cross-tenant by platform support staff. Numbered globally
 * (`TKT-YYYY-NNNN`) so the support desk has one stable reference per ticket.
 */
@Entity('support_tickets')
@Index(['organizationId', 'status'])
@Index(['assignedToUserId'])
export class SupportTicket extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 30 }) number: string;

  @Column({ type: 'varchar', length: 200 }) subject: string;
  @Column({ type: 'text' }) description: string;

  @Column({ type: 'varchar', length: 30, default: 'other' }) category: string;
  @Column({ type: 'varchar', length: 20, default: 'normal' }) priority: string;
  @Column({ type: 'varchar', length: 20, default: 'open' }) status: string;

  // Who raised it (snapshots survive user renames/deletes).
  @Column({ name: 'raised_by_user_id', type: 'uuid', nullable: true }) raisedByUserId: string | null;
  @Column({ name: 'raised_by_name', type: 'varchar', length: 200, nullable: true }) raisedByName: string | null;
  @Column({ name: 'raised_by_email', type: 'varchar', length: 255, nullable: true }) raisedByEmail: string | null;

  // Platform staff handling it.
  @Column({ name: 'assigned_to_user_id', type: 'uuid', nullable: true }) assignedToUserId: string | null;
  @Column({ name: 'assigned_to_name', type: 'varchar', length: 200, nullable: true }) assignedToName: string | null;

  // Optional context captured by the client when the ticket is raised.
  @Column({ name: 'context_url', type: 'varchar', length: 500, nullable: true }) contextUrl: string | null;
  @Column({ name: 'app_version', type: 'varchar', length: 50, nullable: true }) appVersion: string | null;

  @Column({ name: 'last_message_at', type: 'timestamp', nullable: true }) lastMessageAt: Date | null;
  @Column({ name: 'first_response_at', type: 'timestamp', nullable: true }) firstResponseAt: Date | null;
  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true }) resolvedAt: Date | null;
  @Column({ name: 'closed_at', type: 'timestamp', nullable: true }) closedAt: Date | null;

  @OneToMany(() => SupportTicketMessage, (m) => m.ticket) messages: SupportTicketMessage[];

  @VersionColumn() version: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
