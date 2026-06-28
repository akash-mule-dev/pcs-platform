import { io, Socket } from 'socket.io-client';
import * as Ably from 'ably';
import { environment } from '../config/environment';
import { authService } from './auth.service';

/**
 * Real-time client for the PCS backend, speaking one of two transports that are
 * auto-detected from the backend (`GET /realtime/config`) so the same build
 * works everywhere:
 *
 *   - **Ably** (production / any Vercel serverless deploy): the backend can't
 *     hold a WebSocket, so it publishes to Ably's hosted edge and the app
 *     subscribes directly to its tenant + personal channels (`org:<id>`,
 *     `user:<id>`, `system`), routing messages by event name.
 *   - **Socket.IO** (local dev against a persistent `nest start`): the original
 *     in-process gateway + user room.
 *
 * Event names are identical on both, so screens (via useSocketEvent) don't care
 * which is live. Backend events: time-entry-update · stage-update ·
 * dashboard-refresh · work-order-update · notification · unread-count-update.
 *
 * Connection lifecycle is driven by AuthContext: connect() on auth, disconnect()
 * on logout.
 */

const SOCKET_URL = environment.apiUrl.replace(/\/api\/?$/, '');

type Handler = (...args: any[]) => void;

let transport: 'ably' | 'socketio' | null = null;
let connecting = false;
let socket: Socket | null = null;
let ably: any = null;
let currentUserId: string | null = null;
// Project rooms this client wants to be in (for room-scoped `import:progress`).
// Tracked so they're re-joined on every (re)connect. Socket.IO only — on Ably
// import:progress isn't published to a channel, so monitoring falls back to polling.
const joinedProjects = new Set<string>();

// Registry: event name -> handlers. Both transports funnel into dispatch().
const handlers: Record<string, Set<Handler>> = {};
// Socket.IO events bound once (dispatch reads the live registry, so reconnects
// and unsubscribes need no rebinding).
const boundSocketEvents = new Set<string>();

function dispatch(event: string, payload: any): void {
  handlers[event]?.forEach((h) => h(payload));
}

/** Decode a JWT payload without extra deps (Hermes/atob, ASCII claims only). */
function decodeJwt(token: string | null): { sub?: string; organizationId?: string } | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? atob(part) : null;
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

async function detectDriver(): Promise<'ably' | 'socketio'> {
  try {
    const res = await fetch(`${environment.apiUrl}/realtime/config`);
    const body = await res.json();
    const driver = body?.data?.driver ?? body?.driver;
    return driver === 'ably' ? 'ably' : 'socketio';
  } catch {
    return 'socketio';
  }
}

function initAbly(token: string | null): void {
  transport = 'ably';
  ably = new Ably.Realtime({
    // Reads the CURRENT token each time, so refresh / re-login is handled. The
    // server signs the request and scopes capability to this caller's channels.
    authCallback: async (_params: any, cb: (err: any, token: any) => void) => {
      try {
        const tok = await authService.getToken();
        const res = await fetch(`${environment.apiUrl}/realtime/token`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tok ?? ''}` },
        });
        if (!res.ok) throw new Error(`token request failed (${res.status})`);
        const body = await res.json();
        cb(null, body?.data ?? body); // unwrap the API's { data } envelope
      } catch (e) {
        cb(e as any, null);
      }
    },
  });

  const claims = decodeJwt(token);
  const channels = ['system'];
  if (claims?.organizationId) channels.push(`org:${claims.organizationId}`);
  const uid = claims?.sub ?? currentUserId;
  if (uid) channels.push(`user:${uid}`);
  for (const name of channels) {
    ably.channels.get(name).subscribe((msg: any) => dispatch(msg.name, msg.data));
  }
}

function initSocketIo(token: string | null): void {
  transport = 'socketio';
  socket = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    auth: token ? { token } : undefined,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });
  socket.on('connect', () => {
    if (currentUserId) socket?.emit('join-user', currentUserId);
    // Re-assert every project room after a (re)connect so the live import feed survives drops.
    joinedProjects.forEach((projectId) => socket?.emit('join-project', projectId));
  });
  for (const event of Object.keys(handlers)) bindSocketEvent(event);
}

function bindSocketEvent(event: string): void {
  if (transport !== 'socketio' || !socket || boundSocketEvents.has(event)) return;
  boundSocketEvents.add(event);
  socket.on(event, (payload: any) => dispatch(event, payload));
}

export const socketService = {
  get connected(): boolean {
    if (transport === 'ably') return ably?.connection?.state === 'connected';
    return !!socket?.connected;
  },

  /**
   * Whether the live transport delivers the room-scoped `import:progress` feed.
   * Only Socket.IO does — Ably has no project channel — so monitoring screens
   * must keep a polling floor when this is false (also true before the transport
   * has been detected, which is the safe default).
   */
  get importPushAvailable(): boolean {
    return transport === 'socketio';
  },

  /** Open (or re-use) the connection. Detects the transport on first call. */
  async connect(userId?: string): Promise<void> {
    currentUserId = userId ?? authService.currentUser?.id ?? null;

    if (transport) {
      // Already up — re-assert the Socket.IO user room (no-op for Ably).
      if (transport === 'socketio') {
        if (!socket?.connected) socket?.connect();
        if (currentUserId) socket?.emit('join-user', currentUserId);
      }
      return;
    }
    if (connecting) return;
    connecting = true;
    try {
      const token = await authService.getToken();
      const driver = await detectDriver();
      if (driver === 'ably') initAbly(token);
      else initSocketIo(token);
    } finally {
      connecting = false;
    }
  },

  /** Tear down the connection (called on logout). */
  disconnect(): void {
    if (socket && currentUserId) socket.emit('leave-user', currentUserId);
    socket?.disconnect();
    socket = null;
    ably?.close?.();
    ably = null;
    boundSocketEvents.clear();
    joinedProjects.clear();
    transport = null;
    currentUserId = null;
  },

  /**
   * Join a project's room to receive its room-scoped `import:progress` events
   * (the live import-pipeline feed). Idempotent and re-asserted on reconnect.
   * No-op on the Ably transport (the event isn't published to a channel there —
   * monitoring screens poll as a fallback regardless).
   */
  joinProject(projectId: string): void {
    if (!projectId) return;
    joinedProjects.add(projectId);
    if (transport === 'socketio' && socket?.connected) socket.emit('join-project', projectId);
  },

  /** Leave a project's room (screen unmount). */
  leaveProject(projectId: string): void {
    if (!projectId) return;
    joinedProjects.delete(projectId);
    if (transport === 'socketio' && socket?.connected) socket.emit('leave-project', projectId);
  },

  /** Subscribe to a server event. Returns an unsubscribe function. */
  on(event: string, handler: Handler): () => void {
    (handlers[event] ??= new Set()).add(handler);
    bindSocketEvent(event); // no-op until the Socket.IO transport is live
    return () => {
      handlers[event]?.delete(handler);
    };
  },
};
