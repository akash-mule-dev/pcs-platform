import { WebSocketGateway, WebSocketServer, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';

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

  afterInit(_server: Server) {
    this.logger.log('WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
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

  // --- Existing events (payloads sanitized before broadcast) ---

  emitTimeEntryUpdate(data: any) {
    if (this.server) {
      this.server.emit('time-entry-update', sanitize(data));
    }
  }

  emitStageUpdate(data: any) {
    if (this.server) {
      this.server.emit('stage-update', sanitize(data));
    }
  }

  emitDashboardRefresh(data?: any) {
    if (this.server) {
      this.server.emit('dashboard-refresh', sanitize(data) || { timestamp: new Date().toISOString() });
    }
  }

  // --- New events for Phase 5 ---

  /** Send notification to a specific user */
  emitNotification(userId: string, notification: any) {
    if (this.server) {
      this.server.to(`user:${userId}`).emit('notification', sanitize(notification));
      this.server.to(`user:${userId}`).emit('unread-count-update', { userId });
    }
  }

  /** Broadcast work order status change */
  emitWorkOrderUpdate(data: any) {
    if (this.server) {
      this.server.emit('work-order-update', sanitize(data));
    }
  }

  /** Broadcast quality alert */
  emitQualityAlert(data: any) {
    if (this.server) {
      this.server.emit('quality-alert', sanitize(data));
    }
  }

  /** Broadcast alert to all connected clients */
  emitAlert(data: { type: string; title: string; message: string; priority: string }) {
    if (this.server) {
      this.server.emit('alert', sanitize(data));
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
