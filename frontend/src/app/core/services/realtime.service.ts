import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';

/**
 * Shared real-time client for the backend Socket.IO gateway.
 *
 * One connection, multiplexed across all consumers via `on(event)`. Use this
 * for views that must reflect changes made on other clients (web or mobile)
 * without polling — e.g. the dashboard and the work-order list.
 *
 * Backend events (backend/src/websocket/events.gateway.ts):
 *   time-entry-update · stage-update · dashboard-refresh · work-order-update ·
 *   notification · unread-count-update
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  private socket: Socket | null = null;
  private events$ = new Subject<{ event: string; payload: any }>();
  private bound = new Set<string>();

  private ensureSocket(): Socket {
    if (this.socket) return this.socket;
    const wsUrl = environment.apiUrl.replace('/api', '');
    this.socket = io(wsUrl, { transports: ['websocket', 'polling'] });
    return this.socket;
  }

  /** Emits each time the backend pushes `event`. Subscribers share one socket listener. */
  on<T = any>(event: string): Observable<T> {
    const socket = this.ensureSocket();
    if (!this.bound.has(event)) {
      this.bound.add(event);
      socket.on(event, (payload: any) => this.events$.next({ event, payload }));
    }
    return this.events$.pipe(
      filter((e) => e.event === event),
      map((e) => e.payload as T),
    );
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.bound.clear();
  }
}
