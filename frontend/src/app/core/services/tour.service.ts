import { Injectable, inject } from '@angular/core';
import { driver } from 'driver.js';
import { AuthService } from './auth.service';
import { BUILTIN_TOURS, type TourDefinition } from './tour-definitions';

/**
 * In-app guided tours (driver.js), as a small registry.
 *
 * - The global `onboarding` tour auto-runs once on first login and replays from
 *   the toolbar. Page-level tours (`projects`, `project-workspace`, `kanban`, …)
 *   are launched contextually via {@link TourLauncherComponent}, and can auto-run
 *   the first time a user reaches their page.
 * - A per-(tour, version, user) "seen" flag in localStorage keeps auto-start to a
 *   single first-run; bump a tour's `version` to re-surface a revised tour.
 * - Register more tours at runtime with {@link register} (e.g. from a feature
 *   module) — the launcher button appears automatically wherever it's placed.
 */
@Injectable({ providedIn: 'root' })
export class TourService {
  private auth = inject(AuthService);
  private tours = new Map<string, TourDefinition>();

  constructor() {
    for (const t of BUILTIN_TOURS) this.register(t);
  }

  /** Register (or replace) a tour. */
  register(def: TourDefinition): void {
    this.tours.set(def.id, def);
  }

  /** Is a tour registered? Drives launcher-button visibility. */
  hasTour(id: string): boolean {
    return this.tours.has(id);
  }

  private seenKey(id: string, version: string, userId: string): string {
    return `pcs_tour_${id}_${version}_${userId}`;
  }

  hasSeen(id: string): boolean {
    const def = this.tours.get(id);
    const uid = this.auth.currentUser?.id;
    if (!def || !uid) return true; // unknown tour / no user → nothing to surface
    return localStorage.getItem(this.seenKey(id, def.version, uid)) === '1';
  }

  private markSeen(id: string): void {
    const def = this.tours.get(id);
    const uid = this.auth.currentUser?.id;
    if (def && uid) localStorage.setItem(this.seenKey(id, def.version, uid), '1');
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
  maybeAutoStart(id: string): void {
    const def = this.tours.get(id);
    if (!def || !this.eligible(def) || this.hasSeen(id)) return;
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

    const tour = driver({
      showProgress: true,
      animate: true,
      overlayOpacity: 0.6,
      stagePadding: 6,
      stageRadius: 8,
      smoothScroll: true,
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
