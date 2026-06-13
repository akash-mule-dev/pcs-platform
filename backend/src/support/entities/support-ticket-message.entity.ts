import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn,
} from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';
import { SupportTicket } from './support-ticket.entity.js';

/**
 * One entry in a ticket's conversation thread. `authorKind`:
 *  - `customer` — written by the tenant.
 *  - `support`  — written by platform staff (may be an `internal` note, hidden
 *    from the customer).
 *  - `system`   — auto-generated transition note (status change, assignment).
 */
@Entity('support_ticket_messages')
@Index(['ticketId'])
export class SupportTicketMessage extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'ticket_id', type: 'uuid' }) ticketId: string;
  @ManyToOne(() => SupportTicket, (t) => t.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket: SupportTicket;

  @Column({ name: 'author_user_id', type: 'uuid', nullable: true }) authorUserId: string | null;
  @Column({ name: 'author_name', type: 'varchar', length: 200, nullable: true }) authorName: string | null;
  @Column({ name: 'author_kind', type: 'varchar', length: 20, default: 'customer' }) authorKind: string;

  @Column({ type: 'text' }) body: string;

  /** Support-only note — never returned to the customer. */
  @Column({ type: 'boolean', default: false }) internal: boolean;

  @Column({ type: 'jsonb', nullable: true }) attachments: string[] | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
