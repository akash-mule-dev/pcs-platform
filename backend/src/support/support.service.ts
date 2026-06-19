import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SupportTicket } from './entities/support-ticket.entity.js';
import { SupportTicketMessage } from './entities/support-ticket-message.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EventsGateway } from '../websocket/events.gateway.js';
import type { StorageProvider } from '../storage/storage.interface.js';
import { STORAGE_PROVIDER } from '../storage/storage.interface.js';
import { StorageKeys } from '../storage/storage-keys.js';
import {
  SUPPORT_ATTACH_EXTENSIONS, SUPPORT_ATTACH_MIME_TYPES,
} from './support-attachments.constants.js';
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
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
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

  async createTicket(dto: CreateTicketDto, actor: Actor, file?: Express.Multer.File): Promise<any> {
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

    // An attachment supplied with the initial report rides along as the first
    // customer message (multer's fileFilter has already validated the type, so
    // the ticket is never created and then orphaned by a bad upload).
    if (file) {
      const key = await this.storeAttachment(ticket, file);
      await this.addMessage(ticket, { kind: 'customer', body: '(attachment)', actor, attachments: [key] });
    }

    await this.audit.log({ userId: actor.id, action: 'create', entityType: 'support_ticket', entityId: ticket.id, newValues: { number, subject: ticket.subject, priority: ticket.priority } });
    await this.notifyPlatform(`New support ticket ${number}`, `${ticket.subject} — ${name}`, ticket.id);
    this.notifyRealtime(ticket, 'created');
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
    this.notifyRealtime(ticket, 'customer-reply');
    return this.toDetail(ticket.id, { includeInternal: false });
  }

  async closeMine(id: string, actor: Actor): Promise<any> {
    const org = TenantContext.requireOrganizationId();
    const ticket = await this.ticketRepo.findOne({ where: { id, organizationId: org } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.applyStatus(ticket, 'closed', actor, 'closed by customer');
    this.notifyRealtime(ticket, 'closed');
    return this.toDetail(ticket.id, { includeInternal: false });
  }

  // ── platform desk (cross-tenant) ────────────────────────────────────────────

  async listAll(filters: { status?: string; priority?: string; organizationId?: string; assignedToUserId?: string; q?: string; limit?: number; offset?: number }): Promise<{ items: any[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const qb = this.ticketRepo.createQueryBuilder('t')
      .orderBy('t.last_message_at', 'DESC').addOrderBy('t.created_at', 'DESC')
      .take(limit).skip(offset);
    if (filters.status && isValidStatus(filters.status)) qb.andWhere('t.status = :s', { s: filters.status });
    if (filters.priority) qb.andWhere('t.priority = :p', { p: filters.priority });
    if (filters.organizationId) qb.andWhere('t.organization_id = :org', { org: filters.organizationId });
    if (filters.assignedToUserId) qb.andWhere('t.assigned_to_user_id = :a', { a: filters.assignedToUserId });
    if (filters.q) qb.andWhere('(t.subject ILIKE :q OR t.number ILIKE :q)', { q: `%${filters.q}%` });
    // Org names are resolved in a SECOND query, NOT a join: a raw addSelect from a
    // non-relation join crashes TypeORM's take/skip pagination — it can't map the
    // joined column to entity metadata when building the distinct-id ORDER BY.
    const [tickets, total] = await qb.getManyAndCount();
    const names = await this.organizationNames(tickets.map((t) => t.organizationId));
    const items = tickets.map((t) => ({ ...this.toSummary(t), organizationName: names.get(t.organizationId ?? '') ?? null }));
    return { items, total, limit, offset };
  }

  /** Tenants that have raised ≥1 ticket — powers the desk's per-company filter. */
  async listTicketOrganizations(): Promise<Array<{ id: string; name: string }>> {
    return this.ticketRepo.manager.query(
      `SELECT DISTINCT o.id, o.name
         FROM support_tickets t
         JOIN organizations o ON o.id = t.organization_id
        ORDER BY o.name`,
    );
  }

  /** Resolve org id → name for a page of tickets (kept separate from pagination). */
  private async organizationNames(orgIds: Array<string | null>): Promise<Map<string, string>> {
    const ids = [...new Set(orgIds.filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const rows: Array<{ id: string; name: string }> = await this.ticketRepo.manager.query(
      `SELECT id, name FROM organizations WHERE id = ANY($1)`, [ids],
    );
    return new Map(rows.map((r) => [r.id, r.name]));
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
    this.notifyRealtime(ticket, internal ? 'internal-note' : 'support-reply');
    return this.toDetail(ticket.id, { includeInternal: true });
  }

  async update(id: string, dto: UpdateTicketDto, actor: Actor): Promise<any> {
    const ticket = await this.ticketRepo.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    // Optimistic concurrency: a stale desk client must reload before mutating.
    if (dto.expectedVersion !== undefined && dto.expectedVersion !== ticket.version) {
      throw new ConflictException('This ticket was changed by someone else — reload and try again.');
    }
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
        // A ticket can only be handled by platform support staff — never a tenant user.
        const staff = await this.platformAdminIds();
        if (!staff.includes(targetId)) throw new BadRequestException('Tickets can only be assigned to support staff');
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
    this.notifyRealtime(ticket, 'triaged');
    return this.toDetail(ticket.id, { includeInternal: true });
  }

  /** Support staff available to take tickets (the platform-admin pool). */
  async listAgents(): Promise<Array<{ id: string; name: string | null }>> {
    const ids = await this.platformAdminIds();
    if (!ids.length) return [];
    const users = await this.userRepo.findBy({ id: In(ids) } as any);
    return users
      .map((u) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || u.employeeId }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  // ── attachments ─────────────────────────────────────────────────────────────

  /** Customer posts a message with a file (a screenshot of the bug, a PDF). */
  async addCustomerAttachment(id: string, file: Express.Multer.File, body: string | undefined, actor: Actor): Promise<any> {
    const org = TenantContext.requireOrganizationId();
    const ticket = await this.ticketRepo.findOne({ where: { id, organizationId: org } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const key = await this.storeAttachment(ticket, file);
    await this.addMessage(ticket, { kind: 'customer', body: body?.trim() || '(attachment)', actor, attachments: [key] });
    const next = statusAfterCustomerReply(ticket.status as TicketStatus);
    if (next !== ticket.status) await this.applyStatus(ticket, next, null, 'customer reply');
    await this.touch(ticket);
    const title = `Customer reply on ${ticket.number}`;
    if (ticket.assignedToUserId) await this.notifyUsers([ticket.assignedToUserId], title, ticket.subject, ticket.id);
    else await this.notifyPlatform(title, ticket.subject, ticket.id);
    await this.audit.log({ userId: actor.id, action: 'reply', entityType: 'support_ticket', entityId: ticket.id });
    this.notifyRealtime(ticket, 'customer-reply');
    return this.toDetail(ticket.id, { includeInternal: false });
  }

  /** Platform staff posts a message with a file (optionally an internal note). */
  async addSupportAttachment(id: string, file: Express.Multer.File, body: string | undefined, internal: boolean, actor: Actor): Promise<any> {
    const ticket = await this.ticketRepo.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const key = await this.storeAttachment(ticket, file);
    await this.addMessage(ticket, { kind: 'support', body: body?.trim() || '(attachment)', actor, internal, attachments: [key] });
    if (!ticket.firstResponseAt && !internal) ticket.firstResponseAt = new Date();
    if (!internal) {
      const nextStatus = statusAfterSupportReply(ticket.status as TicketStatus);
      if (nextStatus !== ticket.status) await this.applyStatus(ticket, nextStatus, null, 'support reply');
    }
    await this.touch(ticket);
    if (!internal && ticket.raisedByUserId) {
      await this.notifyUsers([ticket.raisedByUserId], `Support replied on ${ticket.number}`, ticket.subject, ticket.id);
    }
    await this.audit.log({ userId: actor.id, action: internal ? 'internal_note' : 'reply', entityType: 'support_ticket', entityId: ticket.id });
    this.notifyRealtime(ticket, internal ? 'internal-note' : 'support-reply');
    return this.toDetail(ticket.id, { includeInternal: true });
  }

  /** Customer attachment download — scoped to the caller's org, internal notes hidden. */
  async getCustomerAttachmentStream(ticketId: string, messageId: string, index: number) {
    const org = TenantContext.requireOrganizationId();
    return this.streamAttachment(ticketId, messageId, index, { organizationId: org, includeInternal: false });
  }

  /** Desk attachment download — cross-tenant, internal notes visible. */
  async getDeskAttachmentStream(ticketId: string, messageId: string, index: number) {
    return this.streamAttachment(ticketId, messageId, index, { includeInternal: true });
  }

  private async streamAttachment(
    ticketId: string, messageId: string, index: number, opts: { organizationId?: string | null; includeInternal: boolean },
  ): Promise<{ stream: NodeJS.ReadableStream; key: string }> {
    const where: any = { id: ticketId };
    if (opts.organizationId) where.organizationId = opts.organizationId;
    const ticket = await this.ticketRepo.findOne({ where });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const msg = await this.msgRepo.findOne({ where: { id: messageId, ticketId } });
    if (!msg) throw new NotFoundException('Attachment not found');
    if (msg.internal && !opts.includeInternal) throw new NotFoundException('Attachment not found');
    const key = msg.attachments?.[index];
    if (!key) throw new NotFoundException('Attachment not found');
    const stream = await this.storage.download(key);
    return { stream, key };
  }

  /** Validate + persist a single uploaded file to object storage, return its key. */
  private async storeAttachment(ticket: SupportTicket, file: Express.Multer.File): Promise<string> {
    if (!file) throw new BadRequestException('No file uploaded');
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    const mimeOk = SUPPORT_ATTACH_MIME_TYPES.includes((file.mimetype || '').toLowerCase());
    const extOk = SUPPORT_ATTACH_EXTENSIONS.includes(ext);
    if (!mimeOk || !extOk) {
      try { fs.unlinkSync(file.path); } catch { /* staging cleanup best-effort */ }
      throw new BadRequestException('Attachment must be a JPEG, PNG, WebP image or a PDF');
    }
    const key = StorageKeys.supportAttachment(ticket.organizationId, ticket.id, crypto.randomUUID(), ext);
    try {
      await this.storage.upload(file.path, key, file.mimetype || 'application/octet-stream');
    } finally {
      // Always remove the staged temp file — even if the object-store upload threw.
      try { fs.unlinkSync(file.path); } catch { /* staging cleanup best-effort */ }
    }
    return key;
  }

  private notifyRealtime(ticket: SupportTicket, action: string): void {
    try {
      this.events.emitSupportEvent({
        ticketId: ticket.id, organizationId: ticket.organizationId,
        number: ticket.number, status: ticket.status, action,
      });
    } catch (e) { this.logger.warn(`emitSupportEvent failed: ${(e as Error).message}`); }
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

  private async addMessage(ticket: SupportTicket, opts: { kind: string; body: string; actor: Actor; internal?: boolean; attachments?: string[] }): Promise<void> {
    const name = await this.displayName(opts.actor.id);
    await this.msgRepo.save(this.msgRepo.create({
      ticketId: ticket.id, organizationId: ticket.organizationId,
      authorUserId: opts.actor.id, authorName: name, authorKind: opts.kind,
      body: opts.body.trim(), internal: !!opts.internal,
      attachments: opts.attachments?.length ? opts.attachments : null,
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
      // SLA signals: a still-open ticket with no first response is "awaiting first reply".
      firstResponseAt: t.firstResponseAt,
      awaitingFirstResponse: !t.firstResponseAt && (t.status === 'open' || t.status === 'in_progress'),
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
        attachmentCount: m.attachments?.length ?? 0,
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
