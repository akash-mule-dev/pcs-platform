import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';

/**
 * Shared real-time client for the backend, multiplexed across all consumers via
 * `on(event)`. It speaks one of two transports, auto-detected from the backend
 * (`GET /realtime/config`) so no per-environment build is needed:
 *
 *   - **Ably** (production / any Vercel serverless deploy): the backend can't
 *     hold a WebSocket, so it publishes to Ably's hosted edge and the browser
 *     subscribes directly. We subscribe to the caller's tenant + personal
 *     channels (`org:<id>`, `user:<id>`, `system`) and route messages by their
 *     event name — identical event names to Socket.IO, so consumers don't care.
 *   - **Socket.IO** (local dev with a persistent `nest start`): the original
 *     in-process gateway, including room joins (`join-project`, support, …).
 *
 * Backend events: time-entry-update · stage-update · dashboard-refresh ·
 * work-order-update · quality-alert · notification · unread-count-update
 * (operational + notification events are carried on both transports).
 * Room-scoped feeds (import:progress, conversion:progress, support:changed)
 * are Socket.IO-only for now — under Ably those views use their polling
 * fallback until migrated.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  private events$ = new Subject<{ event: string; payload: any }>();

  private transport: 'ably' | 'socketio' | null = null;
  private connecting = false;

  // --- Socket.IO state ---
  private socket: Socket | null = null;
  private boundEvents = new Set<string>();
  /** Active room memberships, replayed on every (re)connect so they survive drops. */
  private rooms = new Map<string, { joinEvent: string; payload: string }>();

  // --- Ably state ---
  private ably: any = null;

  /** Event names any consumer has asked for — bound on the Socket.IO transport once it connects. */
  private requestedEvents = new Set<string>();

  /**
   * Decide the transport once and connect. Fire-and-forget: `on()` returns its
   * observable immediately and events flow as soon as the chosen transport is up
   * (same contract as before — nothing arrives until connected).
   */
  private ensureConnected(): void {
    if (this.transport || this.connecting) return;
    this.connecting = true;
    this.detectDriver()
      .then((driver) => (driver === 'ably' ? this.initAbly() : this.initSocketIo()))
      .catch(() => this.initSocketIo())
      .finally(() => (this.connecting = false));
  }

  /** Ask the backend which transport it's running. Falls back to Socket.IO on any error. */
  private async detectDriver(): Promise<'ably' | 'socketio'> {
    try {
      const res = await fetch(`${environment.apiUrl}/realtime/config`);
      const body = await res.json();
      const driver = body?.data?.driver ?? body?.driver;
      return driver === 'ably' ? 'ably' : 'socketio';
    } catch {
      return 'socketio';
    }
  }

  // ── Ably transport ──────────────────────────────────────────────────────────

  private async initAbly(): Promise<void> {
    this.transport = 'ably';
    const apiBase = environment.apiUrl;
    // Code-split: the SDK only loads when Ably is actually the active transport.
    const Lib: any = await import('ably');
    const Realtime = Lib.Realtime ?? Lib.default?.Realtime;

    this.ably = new Realtime({
      // authCallback reads the CURRENT JWT each time, so token refresh / re-login
      // is handled automatically. The server signs the token request and scopes
      // its capability to this caller's own channels.
      authCallback: async (_params: any, cb: (err: any, token: any) => void) => {
        try {
          const token = localStorage.getItem('pcs_token') || '';
          const res = await fetch(`${apiBase}/realtime/token`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) throw new Error(`token request failed (${res.status})`);
          const body = await res.json();
          cb(null, body?.data ?? body); // unwrap the API's { data } envelope
        } catch (e) {
          cb(e, null);
        }
      },
    });

    const claims = this.decodeJwt(localStorage.getItem('pcs_token'));
    const channels = ['system'];
    if (claims?.organizationId) channels.push(`org:${claims.organizationId}`);
    if (claims?.sub) channels.push(`user:${claims.sub}`);
    for (const name of channels) {
      this.ably.channels
        .get(name)
        .subscribe((msg: any) => this.events$.next({ event: msg.name, payload: msg.data }));
    }
  }

  private decodeJwt(token: string | null): { sub?: string; organizationId?: string } | null {
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split('.')[1]));
    } catch {
      return null;
    }
  }

  // ── Socket.IO transport ─────────────────────────────────────────────────────

  private initSocketIo(): void {
    this.transport = 'socketio';
    const wsUrl = environment.apiUrl.replace('/api', '');
    // Send the JWT on the handshake so the gateway can scope rooms to the tenant.
    // The function form runs on every (re)connect, so a refreshed token is used.
    this.socket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: localStorage.getItem('pcs_token') || '' }),
    });
    this.socket.on('connect', () => {
      for (const { joinEvent, payload } of this.rooms.values()) this.socket?.emit(joinEvent, payload);
    });
    for (const event of this.requestedEvents) this.bindSocketEvent(event);
    for (const { joinEvent, payload } of this.rooms.values()) this.socket.emit(joinEvent, payload);
  }

  private bindSocketEvent(event: string): void {
    if (this.transport !== 'socketio' || !this.socket || this.boundEvents.has(event)) return;
    this.boundEvents.add(event);
    this.socket.on(event, (payload: any) => this.events$.next({ event, payload }));
  }

  // ── Public API (unchanged signatures) ────────────────────────────────────────

  /**
   * Join a server-side room (e.g. a project's import-pipeline feed) and keep the
   * membership across reconnects. Socket.IO only — under Ably this is a no-op
   * (those room feeds aren't migrated yet; their views fall back to polling).
   */
  joinRoom(joinEvent: string, payload: string): void {
    const key = `${joinEvent}|${payload}`;
    if (this.rooms.has(key)) return;
    this.rooms.set(key, { joinEvent, payload });
    this.ensureConnected();
    if (this.transport === 'socketio') this.socket?.emit(joinEvent, payload);
  }

  /** Leave a room joined via joinRoom (Socket.IO only). */
  leaveRoom(joinEvent: string, leaveEvent: string, payload: string): void {
    this.rooms.delete(`${joinEvent}|${payload}`);
    if (this.transport === 'socketio') this.socket?.emit(leaveEvent, payload);
  }

  /** Emits each time the backend pushes `event`. Subscribers share one connection. */
  on<T = any>(event: string): Observable<T> {
    this.requestedEvents.add(event);
    this.ensureConnected();
    this.bindSocketEvent(event); // no-op until/unless the Socket.IO transport is live
    return this.events$.pipe(
      filter((e) => e.event === event),
      map((e) => e.payload as T),
    );
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.ably?.close?.();
    this.ably = null;
    this.boundEvents.clear();
    this.rooms.clear();
    this.transport = null;
  }
}
