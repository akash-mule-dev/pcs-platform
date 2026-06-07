import { useEffect, useRef } from 'react';
import { socketService } from '../services/socket.service';

/**
 * Subscribe a screen to a backend real-time event for its lifetime.
 *
 * The handler is held in a ref so it always sees fresh state/props without
 * re-subscribing on every render. Pass a stable event name.
 *
 *   useSocketEvent('time-entry-update', loadData);
 */
export function useSocketEvent(event: string, handler: (...args: any[]) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const off = socketService.on(event, (...args: any[]) => handlerRef.current(...args));
    return off;
  }, [event]);
}

/** Subscribe to several events with the same handler (e.g. "any of these → refetch"). */
export function useSocketEvents(events: string[], handler: (...args: any[]) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  // Stable key so the effect doesn't re-run when the array identity changes.
  const key = events.join('|');

  useEffect(() => {
    const offs = key.split('|').map((event) =>
      socketService.on(event, (...args: any[]) => handlerRef.current(...args)),
    );
    return () => offs.forEach((off) => off());
  }, [key]);
}
