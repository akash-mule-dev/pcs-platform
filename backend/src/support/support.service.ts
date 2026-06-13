import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportTicket } from './entities/support-ticket.entity.js';
import { SupportTicketMessage } from './entities/support-ticket-message.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EventsGateway } from '../websocket/events.gateway.js';
import { CreateTicketDto, ReplyDto, UpdateTicketDto } from './dto/support.dto.js';
import {
  canTransition, CATEGORY_LABELS, isValidStatus, PRIORITY_LABELS, statusAfterCustomerReply,
  statusAfterSupportReply, STATUS_LABELS, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES,
  TicketStatus,
} from './support-workflow.js';

export interface Actor { id: string; email?: string | null; }

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportTicket) private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(SupportTicketMessage) private readonly msgRepo: Repository<SupportTicketMessage>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsGateway,
  ) {}

  /** Option lists for the client dropdowns. */
  meta() {
    return {
      statuses: TICKET_STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] })),
      priorities: TICKET_PRIORITIES.map((v) => ({ value: v, label: PRIORITY_LABELS[v] })),
      categories: TICKET_CATEGORIES.map((v) => ({ value: v, label: CATEGORY_LABELS[v] })),
    };
  }

  // ── customer side (tenant-scoped) ───────────────────────────────────────────

  async createTicket(dto: CreateTicketDto, actor: Actor): Promise<any> {
    const org = TenantContext.requireOrganizationId();
    const name = await this.displayName(actor.id);
    const number = await this.allocateNumber();
    const now = new Date();
    const ticket = await this.ticketRepo.save(
      this.ticketRepo.create({
        number, subject: dto.subject.trim(), description: dto.description.trim(),
        category: dto.category ?? 'other', priority: dto.priority ?? 'normal', status: 'open',
        raisedByUserId: actor.id, raisedByName: name, raisedByEmail: actor.email ?? null,
        contextUrl: dto.contextUrl ?? null, appVersion: dto.appVersion ?? null,
        organizationId: org, lastMessageAt: now,
      } as any),
    ) as unknown as SupportTicket;

    await this.audit.log({ userId: actor.id, action: 'create', entityType: 'support_ticket', entityId: ticket.id, newValues: { number, subject: ticket.subject, priority: ticket.priority } });
    await this.notifyPlatform(`New support ticket ${number}`, `${ticket.subject} — ${name}`, ticket.id);
    return this.toDetail(ticket.id, { includeInternal: false });
  }

  async listMine(filters: { status?: string; q?: string }): Promise<any[]> {
    const org = TenantContext.requireOrganizationId();
    const qb = this.ticketRepo.createQueryBuilder('t')
      .where('t.organization_id = :org', { org })
      .orderBy('t.last_message_at', 'DESC').addOrderBy('t.created_at', 'DESC');
    if (filters.status && isValidStatus(filters.status)) qb.andWhere('t.status = :s', { s: filters.status });
    if (filters.q) qb.andWhere('(t.subject ILIKE :q OR t.number ILIKE :q)', { q: `%${filters.q}%` });
    return (await qb.getMany()).map((t) => this.toSummary(t));
  }

  async getMine(id: string): Promise<any> {
    const org = TenantContext.requireOrganizationId();
    const ticket = await this.ticketRepo.findOne({ where: { id, organizationId: org } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return this.toDetail(ticket.id, { includeInternal: false });
  }

  async replyMine(id: string, dto: ReplyDto, actor: Actor): Promise<any> {
    const org = TenantContext.requireOrganizationId();
    const ticket = await this.ticketRepo.findOne({ where: { id, organizationId: org } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.addMessage(ticket, { kind: 'customer', body: dto.body, actor });
    const next = statusAfterCustomerReply(ticket.status as TicketStatus);
    if (next !== ticket.status) await this.applyStatus(ticket, next, null, 'customer reply');
    await this.touch(ticket);
    // Nudge whoever owns it (assignee, else the whole desk).
    const title = `Customer reply on ${ticket.number}`;
    if (ticket.assignedToUserId) await this.notifyUsers([ticket.assignedToUserId], title, ticket.subject, ticket.id);
    else await this.notifyPlatform(title, ticket.subject, ticket.id);
    return this.toDetail(ticket.id, { includeInternal: false });
  }

  async closeMine(id: string, actor: Actor): Promise<any> {
    const org = TenantContext.requireOrganizationId();
    const ticket = await this.ticketRepo.findOne({ where: { id, organizationId: org } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.applyStatus(ticket, 'closed', actor, 'closed by customer');
    return this.toDetail(ticket.id, { includeInternal: false });
  }

  // ── platform desk (cross-tenant) ────────────────────────────────────────────

  async listAll(filters: { status?: string; priority?: string; organizationId?: string; assignedToUserId?: string; q?: string }): Promise<any[]> {
    const qb = this.ticketRepo.createQueryBuilder('t')
      .leftJoin('organizations', 'o', 'o.id = t.organization_id')
      .addSelect('o.name', 'org_name')
      .orderBy('t.last_message_at', 'DESC').addOrderBy('t.created_at', 'DESC');
    if (filters.status && isValidStatus(filters.status)) qb.andWhere('t.status = :s', { s: filters.status });
    if (filters.priority) qb.andWhere('t.priority = :p', { p: filters.priority });
    if (filters.organizationId) qb.andWhere('t.organization_id = :org', { org: filters.organizationId });
    if (filters.assignedToUserId) qb.andWhere('t.assigned_to_user_id = :a', { a: filters.assignedToUserId });
    if (filters.q) qb.andWhere('(t.subject ILIKE :q OR t.number ILIKE :q)', { q: `%${filters.q}%` });
    const { entities, raw } = await qb.getRawAndEntities();
    return entities.map((t, i) => ({ ...this.toSummary(t), organizationName: raw[i]?.org_name ?? null }));
  }

  async stats(): Promise<Record<string, number>> {
    const rows: Array<{ status: string; count: string }> = await this.ticketRepo
      .createQueryBuilder('t').select('t.status', 'status').addSelect('COUNT(*)', 'count')
      .groupBy('t.status').getRawMany();
    const out: Record<string, number> = { total: 0 };
    for (const r of rows) { out[r.status] = Number(r.count); out['total'] += Number(r.count); }
    return out;
  }

  async getAny(id: string): Promise<any> {
    const ticket = await this.ticketRepo.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return this.toDetail(ticket.id, { includeInternal: true });
  }

  async replySupport(id: string, dto: ReplyDto, actor: Actor): Promise<any> {
    const ticket = await this.ticketRepo.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const internal = !!dto.internal;
    await this.addMessage(ticket, { kind: 'support', body: dto.body, actor, internal });
    if (!ticket.firstResponseAt && !internal) ticket.firstResponseAt = new Date();
    if (!internal) {
      const next = statusAfterSupportReply(ticket.status as TicketStatus);
      if (next !== ticket.status) await this.applyStatus(ticket, next, null, 'support reply');
    }
    await this.touch(ticket);
    if (!internal && ticket.raisedByUserId) {
      await this.notifyUsers([ticket.raisedByUserId], `Support replied on ${ticket.number}`, ticket.subject, ticket.id);
    }
    await this.audit.log({ userId: actor.id, action: internal ? 'internal_note' : 'reply', entityType: 'support_ticket', entityId: ticket.id });
    return this.toDetail(ticket.id, { includeInternal: true });
  }

  async update(id: string, dto: UpdateTicketDto, actor: Actor): Promise<any> {
    const ticket = await this.ticketRepo.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const before = { status: ticket.status, priority: ticket.priority, assignedToUserId: ticket.assignedToUserId };

    if (dto.priority && dto.priority !== ticket.priority) {
      ticket.priority = dto.priority;
      await this.systemMessage(ticket, `Priority set to ${PRIORITY_LABELS[dto.priority as keyof typeof PRIORITY_LABELS] ?? dto.priority}`, actor);
    }
    if (dto.assignedToUserId !== undefined) {
      const targetId = dto.assignedToUserId === 'me' ? actor.id : dto.assignedToUserId;
      if (!targetId) {
        ticket.assignedToUserId = null; ticket.assignedToName = null;
        await this.systemMessage(ticket, 'Unassigned', actor);
      } else {
        const name = await this.displayName(targetId);
        ticket.assignedToUserId = targetId; ticket.assignedToName = name;
        await this.systemMessage(ticket, `Assigned to ${name}`, actor);
      }
    }
    if (dto.status && dto.status !== ticket.status) {
      if (!isValidStatus(dto.status) || !canTransition(ticket.status as TicketStatus, dto.status)) {
        throw new BadRequestException(`Cannot move ticket from ${ticket.status} to ${dto.status}`);
      }
      await this.applyStatus(ticket, dto.status, actor, 'status updated');
      if (ticket.raisedByUserId) {
        await this.notifyUsers([ticket.raisedByUserId], `Ticket ${ticket.number} is now ${STATUS_LABELS[dto.status]}`, ticket.subject, ticket.id);
      }
    }
    await this.ticketRepo.save(ticket);
    await this.audit.log({ userId: actor.id, action: 'update', entityType: 'support_ticket', entityId: ticket.id, oldValues: before, newValues: { status: ticket.status, priority: ticket.priority, assignedToUserId: ticket.assignedToUserId } });
    return this.toDetail(ticket.id, { includeInternal: true });
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private async allocateNumber(): Promise<string> {
    const prefix = `TKT-${new Date().getFullYear()}-`;
    for (let attempt = 0; attempt < 6; attempt++) {
      const rows: Array<{ num: string }> = await this.ticketRepo.query(
        `SELECT number AS num FROM support_tickets WHERE number LIKE $1 ORDER BY number DESC LIMIT 1`, [`${prefix}%`],
      );
      const base = rows?.[0]?.num ? parseInt(rows[0].num.slice(prefix.length), 10) || 0 : 0;
      const candidate = `${prefix}${String(base + 1).padStart(4, '0')}`;
      // Probe to keep retries cheap; the unique index is the real guard.
      const clash = await this.ticketRepo.findOne({ where: { number: candidate } });
      if (!clash) return candidate;
    }
    // Fallback: time-based suffix (extremely unlikely to be reached).
    return `${prefix}${Date.now().toString().slice(-6)}`;
  }

  private async addMessage(ticket: SupportTicket, opts: { kind: string; body: string; actor: Actor; internal?: boolean }): Promise<void> {
    const name = await this.displayName(opts.actor.id);
    await this.msgRepo.save(this.msgRepo.create({
      ticketId: ticket.id, organizationId: ticket.organizationId,
      authorUserId: opts.actor.id, authorName: name, authorKind: opts.kind,
      body: opts.body.trim(), internal: !!opts.internal,
    } as any));
  }

  private async systemMessage(ticket: SupportTicket, body: string, actor: Actor): Promise<void> {
    const name = await this.displayName(actor.id);
    await this.msgRepo.save(this.msgRepo.create({
      ticketId: ticket.id, organizationId: ticket.organizationId,
      authorUserId: actor.id, authorName: name, authorKind: 'system', body, internal: false,
    } as any));
  }

  private async applyStatus(ticket: SupportTicket, status: TicketStatus, actor: Actor | null, reason: string): Promise<void> {
    const from = ticket.status;
    ticket.status = status;
    if (status === 'resolved') ticket.resolvedAt = new Date();
    if (status === 'closed') ticket.closedAt = new Date();
    if (status === 'open' || status === 'in_progress') { ticket.resolvedAt = null; ticket.closedAt = null; }
    await this.ticketRepo.save(ticket);
    const note = `Status: ${STATUS_LABELS[from as TicketStatus] ?? from} → ${STATUS_LABELS[status]} (${reason})`;
    await this.msgRepo.save(this.msgRepo.create({
      ticketId: ticket.id, organizationId: ticket.organizationId,
      authorUserId: actor?.id ?? null, authorName: actor ? await this.displayName(actor.id) : 'System',
      authorKind: 'system', body: note, internal: false,
    } as any));
  }

  private async touch(ticket: SupportTicket): Promise<void> {
    ticket.lastMessageAt = new Date();
    await this.ticketRepo.save(ticket);
  }

  private async displayName(userId?: string | null): Promise<string | null> {
    if (!userId) return null;
    const u = await this.userRepo.findOne({ where: { id: userId } });
    if (!u) return null;
    return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || u.employeeId;
  }

  private toSummary(t: SupportTicket) {
    return {
      id: t.id, number: t.number, subject: t.subject, category: t.category, priority: t.priority, status: t.status,
      raisedByName: t.raisedByName, assignedToName: t.assignedToName, assignedToUserId: t.assignedToUserId,
      organizationId: t.organizationId, lastMessageAt: t.lastMessageAt, createdAt: t.createdAt,
    };
  }

  private async toDetail(id: string, opts: { includeInternal: boolean }) {
    const ticket = await this.ticketRepo.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const where: any = { ticketId: id };
    if (!opts.includeInternal) where.internal = false;
    const messages = await this.msgRepo.find({ where, order: { createdAt: 'ASC' } });
    return {
      ...this.toSummary(ticket),
      description: ticket.description,
      raisedByEmail: ticket.raisedByEmail,
      contextUrl: ticket.contextUrl,
      appVersion: ticket.appVersion,
      firstResponseAt: ticket.firstResponseAt,
      resolvedAt: ticket.resolvedAt,
      closedAt: ticket.closedAt,
      version: ticket.version,
      messages: messages.map((m) => ({
        id: m.id, authorName: m.authorName, authorKind: m.authorKind, body: m.body,
        internal: m.internal, createdAt: m.createdAt,
      })),
    };
  }

  // ── notifications (best-effort) ─────────────────────────────────────────────

  private async platformAdminIds(): Promise<string[]> {
    const users = await this.userRepo.createQueryBuilder('u')
      .leftJoin('u.role', 'r')
      .where('r.is_system = true').andWhere(`r.name = 'platform-admin'`).andWhere('u.is_active = true')
      .getMany();
    return users.map((u) => u.id);
  }

  private async notifyPlatform(title: string, message: string, ticketId: string): Promise<void> {
    try {
      const ids = await this.platformAdminIds();
      await this.notifyUsers(ids, title, message, ticketId);
    } catch (e) { this.logger.warn(`notifyPlatform failed: ${(e as Error).message}`); }
  }

  private async notifyUsers(userIds: string[], title: string, message: string, ticketId: string): Promise<void> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return;
    try {
      await this.notifications.createForUsers(ids, {
        title, message, type: 'SYSTEM' as any, priority: 'MEDIUM' as any,
        entityType: 'support_ticket', entityId: ticketId,
      } as any);
      for (const uid of ids) {
        try { this.events.emitNotification(uid, { title, message, entityType: 'support_ticket', entityId: ticketId }); } catch {}
      }
    } catch (e) { this.logger.warn(`notifyUsers failed: ${(e as Error).message}`); }
  }
}
