import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { driver } from 'driver.js';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import { BUILTIN_TOURS, type TourDefinition } from './tour-definitions';

/**
 * In-app guided tours (driver.js), as a small registry.
 *
 * - The global `onboarding` tour auto-runs once on first login and replays from
 *   the toolbar. Page-level tours (`projects`, `project-workspace`, `kanban`, …)
 *   are launched contextually via {@link TourLauncherComponent}, and can auto-run
 *   the first time a user reaches their page.
 * - "Seen" state is SERVER-SIDE (`users.tour_state` = `{ [tourId]: version }`) so
 *   onboarding follows the user across devices. It's loaded once per session and
 *   cached in memory; writes are optimistic (cache first, then best-effort API).
 *   A stored version below the current tour version re-surfaces that tour.
 * - Register more tours at runtime with {@link register} (e.g. from a feature
 *   module) — the launcher button appears automatically wherever it's placed.
 */
@Injectable({ providedIn: 'root' })
export class TourService {
  private auth = inject(AuthService);
  private http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/auth/tours`;

  private tours = new Map<string, TourDefinition>();

  /** Cached server state: { [tourId]: seenVersion }. */
  private seen: Record<string, string> = {};
  private loadedForUser: string | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor() {
    for (const t of BUILTIN_TOURS) this.register(t);
    // Reset the cache whenever the signed-in user changes (login / logout /
    // entering or leaving a support session) so state never leaks across users.
    this.auth.currentUser$.subscribe((u) => {
      if (u?.id !== this.loadedForUser) {
        this.seen = {};
        this.loadedForUser = null;
        this.loadPromise = null;
      }
    });
  }

  /** Register (or replace) a tour. */
  register(def: TourDefinition): void {
    this.tours.set(def.id, def);
  }

  /** Is a tour registered? Drives launcher-button visibility. */
  hasTour(id: string): boolean {
    return this.tours.has(id);
  }

  /** All registered tours. */
  all(): TourDefinition[] {
    return Array.from(this.tours.values());
  }

  /** Page tours whose `match()` accepts the given URL (for the Help menu). */
  contextualTours(url: string): TourDefinition[] {
    return this.all().filter((t) => t.match?.(url));
  }

  /** Load this user's seen-state from the server once; cached thereafter. */
  private ensureLoaded(): Promise<void> {
    const uid = this.auth.currentUser?.id;
    if (!uid) return Promise.resolve();
    if (this.loadedForUser === uid) return Promise.resolve();
    if (!this.loadPromise) {
      this.loadPromise = firstValueFrom(this.http.get<Record<string, string>>(this.api))
        .then((map) => {
          this.seen = map ?? {};
          this.loadedForUser = uid;
        })
        // Degrade gracefully (old backend / offline): treat as "nothing seen",
        // but don't keep retrying every navigation within this session.
        .catch(() => {
          this.seen = {};
          this.loadedForUser = uid;
        });
    }
    return this.loadPromise;
  }

  /** Has the user seen the CURRENT version of this tour? (cache must be loaded) */
  hasSeen(id: string): boolean {
    const def = this.tours.get(id);
    if (!def || !this.auth.currentUser) return true; // unknown tour / no user → nothing to surface
    return this.seen[id] === def.version;
  }

  private markSeen(id: string): void {
    const def = this.tours.get(id);
    if (!def || !this.auth.currentUser) return;
    this.seen[id] = def.version; // optimistic — UI never waits on the write
    firstValueFrom(this.http.patch(this.api, { tourId: id, version: def.version })).catch(() => {});
  }

  /**
   * Clear "seen" flags so auto-tours surface again — one tour by id, or all of
   * this user's tours when no id is given (the "Reset tour tips" action).
   */
  resetSeen(id?: string): void {
    if (!this.auth.currentUser) return;
    if (id) {
      delete this.seen[id];
      firstValueFrom(this.http.delete(this.api, { params: { tourId: id } })).catch(() => {});
    } else {
      this.seen = {};
      firstValueFrom(this.http.delete(this.api)).catch(() => {});
    }
  }

  /**
   * Shared audience gate for AUTO-start (manual replay ignores this). The org-less
   * platform operator has a different nav, and a support/impersonation session is a
   * staff member who already knows the product — neither should be auto-onboarded.
   */
  private baseEligible(): boolean {
    if (!this.auth.currentUser) return false;
    if (this.auth.userRole === 'platform-admin') return false;
    if (this.auth.impersonation) return false;
    return true;
  }

  private eligible(def: TourDefinition): boolean {
    return this.baseEligible() && (def.eligible?.() ?? true);
  }

  /** Auto-run a tour the first time an eligible user reaches its page. */
  async maybeAutoStart(id: string): Promise<void> {
    const def = this.tours.get(id);
    if (!def || !this.eligible(def)) return;
    await this.ensureLoaded(); // know the real seen-state before deciding
    if (this.hasSeen(id)) return;
    // Give the page a beat to render before we highlight elements.
    setTimeout(() => this.start(id), 800);
  }

  /** Manually (re)start a tour. Always available when registered. */
  start(id: string): void {
    const def = this.tours.get(id);
    if (!def) return;
    // Drop element steps whose anchor isn't in the DOM (empty state, collapsed
    // nav, mobile, permission-hidden item) — centered steps (no element) survive.
    const steps = def.steps().filter(
      (s) => !s.element || typeof s.element !== 'string' || !!document.querySelector(s.element),
    );
    if (steps.length === 0) return;

    // Respect the OS "reduce motion" preference: no fly-in / smooth-scroll.
    const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    const tour = driver({
      showProgress: true,
      animate: !reduceMotion,
      overlayOpacity: 0.6,
      stagePadding: 6,
      stageRadius: 8,
      smoothScroll: !reduceMotion,
      popoverClass: 'pcs-tour',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Got it',
      steps,
      // Fires on finish AND on close/escape — either way, don't nag again.
      onDestroyed: () => this.markSeen(id),
    });
    tour.drive();
  }
}
