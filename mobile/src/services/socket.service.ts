import { io, Socket } from 'socket.io-client';
import { environment } from '../config/environment';
import { authService } from './auth.service';

/**
 * Real-time client for the PCS backend Socket.IO gateway.
 *
 * The backend emits (see backend/src/websocket/events.gateway.ts):
 *   - time-entry-update   (clock in/out)
 *   - stage-update        (clock in/out, stage status change)
 *   - dashboard-refresh   (clock in/out, shift summary)
 *   - work-order-update   (work order create / status / assignment)
 *   - notification        (targeted to user:<id>)
 *   - unread-count-update (targeted to user:<id>)
 *
 * Connection lifecycle is driven by AuthContext: connect() on auth,
 * disconnect() on logout. Screens subscribe via the useSocketEvent hook.
 */

// Strip the trailing /api so we connect to the gateway root, matching the web client.
const SOCKET_URL = environment.apiUrl.replace(/\/api\/?$/, '');

type Handler = (...args: any[]) => void;

let socket: Socket | null = null;
let currentUserId: string | null = null;
// Registry so handlers registered before the socket exists still attach on connect.
const handlers: Record<string, Set<Handler>> = {};

function attachAll() {
  if (!socket) return;
  Object.entries(handlers).forEach(([event, set]) => {
    set.forEach((h) => socket?.on(event, h));
  });
}

export const socketService = {
  get connected(): boolean {
    return !!socket?.connected;
  },

  /** Open (or re-use) the connection and join the user's room for targeted events. */
  async connect(userId?: string): Promise<void> {
    currentUserId = userId ?? authService.currentUser?.id ?? null;

    if (socket) {
      if (!socket.connected) socket.connect();
      if (currentUserId) socket.emit('join-user', currentUserId);
      return;
    }

    const token = await authService.getToken();
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
    });

    // Re-attach any handlers that screens registered before we connected.
    attachAll();
  },

  /** Tear down the connection (called on logout). */
  disconnect(): void {
    if (socket && currentUserId) socket.emit('leave-user', currentUserId);
    socket?.disconnect();
    socket = null;
    currentUserId = null;
  },

  /** Subscribe to a server event. Returns an unsubscribe function. */
  on(event: string, handler: Handler): () => void {
    (handlers[event] ??= new Set()).add(handler);
    socket?.on(event, handler);
    return () => {
      handlers[event]?.delete(handler);
      socket?.off(event, handler);
    };
  },
};
