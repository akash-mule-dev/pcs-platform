import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/**
 * Consistent loading / error / empty wrapper for list & dashboard pages.
 *
 * Wrap a list's content in `<app-list-state>` and drive it from the host's
 * `loading` / `error` / `empty` flags:
 *
 *   <app-list-state [loading]="loading" [error]="error" [empty]="rows.length === 0"
 *                   emptyIcon="inbox" emptyTitle="No work orders"
 *                   emptyText="Create one to get started." (retry)="load()">
 *     ...the actual list/table here...
 *   </app-list-state>
 *
 * Precedence: loading → error (+Retry) → empty → projected content. Hosts that
 * need a *contextual* empty message (e.g. "no matches" vs "nothing yet") can omit
 * `[empty]` and keep their own `@empty` block — only loading/error are handled here.
 * Accessible: spinner is aria-busy/role=status, the error block is role=alert.
 */
@Component({
  selector: 'app-list-state',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    @if (loading) {
      <div class="ls-center" role="status" aria-live="polite" aria-busy="true">
        <mat-spinner [diameter]="32"></mat-spinner>
        <p class="ls-msg">{{ loadingText }}</p>
      </div>
    } @else if (error) {
      <div class="ls-center ls-error" role="alert">
        <mat-icon aria-hidden="true">error_outline</mat-icon>
        <p class="ls-msg">{{ error }}</p>
        @if (retry.observed) {
          <button type="button" class="ls-retry" (click)="retry.emit()" aria-label="Retry loading">
            <mat-icon aria-hidden="true">refresh</mat-icon> Retry
          </button>
        }
      </div>
    } @else if (empty) {
      <div class="ls-center ls-empty">
        <mat-icon class="ls-empty-icon" aria-hidden="true">{{ emptyIcon }}</mat-icon>
        <h3>{{ emptyTitle }}</h3>
        @if (emptyText) { <p class="ls-msg">{{ emptyText }}</p> }
      </div>
    } @else {
      <ng-content></ng-content>
    }
  `,
  styles: [`
    .ls-center {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 12px; padding: 48px 24px; text-align: center;
    }
    .ls-msg { margin: 0; font-size: 13px; color: var(--clay-text-muted); max-width: 420px; line-height: 1.5; }
    .ls-error mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--danger); }
    .ls-error .ls-msg { color: var(--clay-text-secondary); }
    .ls-retry {
      display: inline-flex; align-items: center; gap: 6px;
      min-height: 44px; padding: 0 18px; margin-top: 4px;
      border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm);
      background: var(--clay-surface); color: var(--clay-primary);
      font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
      transition: all 0.15s;
    }
    .ls-retry:hover { border-color: var(--clay-primary); background: var(--info-bg); }
    .ls-retry mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .ls-empty-icon { font-size: 56px; width: 56px; height: 56px; color: var(--clay-text-muted); opacity: 0.5; }
    .ls-empty h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--clay-text); }
  `],
})
export class ListStateComponent {
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input() empty = false;
  @Input() loadingText = 'Loading…';
  @Input() emptyIcon = 'inbox';
  @Input() emptyTitle = 'Nothing here yet';
  @Input() emptyText: string | null = null;
  @Output() retry = new EventEmitter<void>();
}
