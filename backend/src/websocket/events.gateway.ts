import { WebSocketGateway, WebSocketServer, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AblyService } from '../realtime/ably.service.js';

/** Authenticated principal derived from the socket handshake JWT (if present). */
interface SocketAuth { userId: string; organizationId: string | null; role: string | null; }

/**
 * Keys stripped from every socket payload. WebSocket emits do NOT pass through
 * the HTTP TransformInterceptor, so entity payloads (e.g. a time entry with its
 * `user` relation) would otherwise broadcast `user.passwordHash` to all clients.
 */
const SENSITIVE_KEYS = new Set(['passwordHash', 'password_hash', 'password']);

/**
 * Recursively strip sensitive keys from a payload, preserving shape (so socket
 * consumers still receive user.firstName etc.). Mirrors the HTTP interceptor's
 * sanitizer: Dates/Buffers pass through, arrays/objects recurse, and an
 * ancestors-in-path set breaks cycles without dropping shared sibling refs.
 */
function sanitize(value: any, ancestors = new WeakSet<object>()): any {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value;
  if (ancestors.has(value)) return undefined;

  ancestors.add(value);
  let result: any;
  if (Array.isArray(value)) {
    result = value.map((v) => sanitize(v, ancestors));
  } else {
    result = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      result[k] = sanitize(v, ancestors);
    }
  }
  ancestors.delete(value);
  return result;
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
      : ['http://localhost:4200', 'http://localhost:8100'],
  },
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwt: JwtService, private readonly ably: AblyService) {}

  /**
   * Route an event to one channel/room. In production (ABLY_API_KEY set) it
   * publishes over Ably's hosted edge — the only transport that survives Vercel
   * serverless. In local dev it uses the in-process Socket.IO server. Channel
   * names are identical on both transports (`org:<id>`, `user:<id>`, `system`),
   * so consumers don't care which is live. `system` means "everyone".
   */
  private publish(channel: string, event: string, payload: any): void {
    const data = sanitize(payload);
    if (this.ably.enabled) {
      this.ably.publish(channel, event, data);
      return;
    }
    if (!this.server) return;
    if (channel === 'system') this.server.emit(event, data);
    else this.server.to(channel).emit(event, data);
  }

  afterInit(_server: Server) {
    this.logger.log('WebSocket gateway initialized');
  }

  /**
   * Verify the handshake JWT (same secret as HTTP auth) and stash the principal
   * on `client.data.auth`. Verification is best-effort: an anonymous socket is
   * still allowed to connect (so the existing project/conversion/user feeds keep
   * working), but the sensitive support rooms below refuse to join without it.
   */
  handleConnection(client: Socket) {
    try {
      const raw = client.handshake?.auth?.token
        || String(client.handshake?.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      if (raw) {
        const p: any = this.jwt.verify(raw);
        const auth: SocketAuth = { userId: p.sub, organizationId: p.organizationId ?? null, role: p.role ?? null };
        client.data.auth = auth;
        // Auto-join the caller's tenant room so org-scoped operational events
        // (work-order / stage / dashboard / quality) reach ONLY this tenant's
        // clients. The org comes from the verified JWT, never a client-supplied
        // value — same trust model as the support rooms below. Re-runs on every
        // (re)connect, so membership survives drops.
        if (auth.organizationId) client.join(`org:${auth.organizationId}`);
      }
    } catch {
      // Invalid/expired token → treated as anonymous (no org/support-room access).
    }
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /** Allow clients to join a user-specific room for targeted notifications */
  @SubscribeMessage('join-user')
  handleJoinUser(client: Socket, userId: string) {
    client.join(`user:${userId}`);
    this.logger.debug(`Client ${client.id} joined room user:${userId}`);
  }

  /** Allow clients to leave user room */
  @SubscribeMessage('leave-user')
  handleLeaveUser(client: Socket, userId: string) {
    client.leave(`user:${userId}`);
  }

  /** Watch a single conversion job's progress */
  @SubscribeMessage('join-conversion')
  handleJoinConversion(client: Socket, jobId: string) {
    client.join(`conversion:${jobId}`);
  }

  @SubscribeMessage('leave-conversion')
  handleLeaveConversion(client: Socket, jobId: string) {
    client.leave(`conversion:${jobId}`);
  }

  /**
   * Watch a project's import pipeline (upload → extract → convert). Import
   * progress is emitted ONLY to this room (not broadcast) so one tenant's
   * file names never reach another tenant's clients.
   */
  @SubscribeMessage('join-project')
  handleJoinProject(client: Socket, projectId: string) {
    if (typeof projectId === 'string' && projectId) client.join(`project:${projectId}`);
  }

  @SubscribeMessage('leave-project')
  handleLeaveProject(client: Socket, projectId: string) {
    if (typeof projectId === 'string' && projectId) client.leave(`project:${projectId}`);
  }

  /**
   * Support real-time rooms (two-sided ticketing). Two room kinds, BOTH derived
   * from the authenticated handshake — never from client-supplied values:
   *  - `support-org:<orgId>` — a tenant's own queue; the org comes from the JWT,
   *    so a client can only ever join its OWN tenant room.
   *  - `support-desk`        — the platform-wide queue; joined only by org-less
   *    platform operators (the only principals who hold `support-desk.view`).
   * Payloads are metadata only (id/number/status); clients re-fetch the thread
   * through their own permission-scoped endpoint, so internal notes never leak.
   */
  @SubscribeMessage('join-support-org')
  handleJoinSupportOrg(client: Socket) {
    const org = (client.data?.auth as SocketAuth | undefined)?.organizationId;
    if (org) client.join(`support-org:${org}`);
  }

  @SubscribeMessage('leave-support-org')
  handleLeaveSupportOrg(client: Socket) {
    const org = (client.data?.auth as SocketAuth | undefined)?.organizationId;
    if (org) client.leave(`support-org:${org}`);
  }

  @SubscribeMessage('join-support-desk')
  handleJoinSupportDesk(client: Socket) {
    const auth = client.data?.auth as SocketAuth | undefined;
    // The desk is platform-only; platform operators are org-less.
    if (auth && !auth.organizationId) client.join('support-desk');
  }

  @SubscribeMessage('leave-support-desk')
  handleLeaveSupportDesk(client: Socket) {
    client.leave('support-desk');
  }

  // --- Tenant-scoped operational events --------------------------------------
  //
  // These used to be GLOBAL broadcasts (this.server.emit) — every connected
  // client, across every tenant, received every other tenant's work-order /
  // stage / dashboard / quality changes (a cross-tenant data leak + an N-clients
  // scaling cost). They now go to the owning tenant's `org:<id>` room only.

  /** Resolve the owning org from an explicit id, else the payload's organizationId. */
  private orgOf(payload: any, orgId?: string | null): string | null {
    if (orgId) return orgId;
    if (Array.isArray(payload)) return payload[0]?.organizationId ?? null;
    return payload?.organizationId ?? null;
  }

  /**
   * Emit an operational event to ONE tenant's channel (`org:<id>`) so a change
   * in one organization never reaches another tenant's clients. Falls back to
   * the shared `system` channel (with a warning) only when the org genuinely
   * can't be resolved — preserving delivery rather than silently dropping it.
   */
  private emitToOrg(event: string, payload: any, orgId?: string | null): void {
    const org = this.orgOf(payload, orgId);
    if (org) {
      this.publish(`org:${org}`, event, payload);
    } else {
      this.logger.warn(`Emitting '${event}' without org context — using the shared system channel`);
      this.publish('system', event, payload);
    }
  }

  emitTimeEntryUpdate(data: any, orgId?: string | null) {
    this.emitToOrg('time-entry-update', data, orgId);
  }

  emitStageUpdate(data: any, orgId?: string | null) {
    this.emitToOrg('stage-update', data, orgId);
  }

  emitDashboardRefresh(orgId?: string | null, data?: any) {
    this.emitToOrg('dashboard-refresh', data ?? { timestamp: new Date().toISOString() }, orgId);
  }

  // --- New events for Phase 5 ---

  /** Send a notification to a specific user (their personal `user:<id>` channel). */
  emitNotification(userId: string, notification: any) {
    this.publish(`user:${userId}`, 'notification', notification);
    this.publish(`user:${userId}`, 'unread-count-update', { userId });
  }

  /** Work-order create / status / assignment change — scoped to the owning tenant. */
  emitWorkOrderUpdate(data: any, orgId?: string | null) {
    this.emitToOrg('work-order-update', data, orgId);
  }

  /** Quality alert (failed inspection / sign-off) — scoped to the owning tenant. */
  emitQualityAlert(data: any, orgId?: string | null) {
    this.emitToOrg('quality-alert', data, orgId);
  }

  /** Broadcast a platform-wide alert to all connected clients (shared `system` channel). */
  emitAlert(data: { type: string; title: string; message: string; priority: string }) {
    this.publish('system', 'alert', data);
  }

  /**
   * Live import-pipeline progress for a project (room-scoped — see
   * join-project). Fired on every stage transition and on progress ticks.
   */
  emitImportProgress(data: {
    importFileId: string;
    projectId: string;
    status: string;
    stage: string;
    progress: number;
    [key: string]: any;
  }) {
    if (this.server) {
      this.server.to(`project:${data.projectId}`).emit('import:progress', sanitize(data));
    }
  }

  /**
   * Support ticket change — fan a lightweight `support:changed` signal to the
   * affected tenant's room and the platform desk room. The payload carries only
   * non-sensitive metadata (id/number/status/action); recipients reload their
   * list and, if the changed ticket is the one open, re-fetch the thread via
   * their own permission-scoped endpoint — so internal notes never leave the API.
   */
  emitSupportEvent(data: {
    ticketId: string;
    organizationId: string | null;
    number: string;
    status: string;
    action: string;
  }) {
    if (!this.server) return;
    const payload = sanitize(data);
    this.server.to('support-desk').emit('support:changed', payload);
    if (data.organizationId) {
      this.server.to(`support-org:${data.organizationId}`).emit('support:changed', payload);
    }
  }

  /** Broadcast file-conversion progress (any format -> GLB) */
  emitConversionProgress(data: {
    jobId: string;
    status: string;
    progress: number;
    [key: string]: any;
  }) {
    if (this.server) {
      this.server.emit('conversion:progress', sanitize(data));
      this.server.to(`conversion:${data.jobId}`).emit('conversion:progress', sanitize(data));
    }
  }
}
