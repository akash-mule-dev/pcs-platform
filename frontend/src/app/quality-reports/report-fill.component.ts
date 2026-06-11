import { Component, OnInit, OnDestroy, ViewChild, ElementRef, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { QualityReportsService, QualityReport } from '../core/services/quality-reports.service';

const BOOTSTRAP_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/4.6.2/css/bootstrap.min.css';
const FORMIO_CSS = 'https://cdn.form.io/formiojs/formio.full.min.css';
const FORMIO_JS = 'https://cdn.form.io/formiojs/formio.full.min.js';

/**
 * Full-screen QC report fill page — /qr/:id
 *
 * Deliberately OUTSIDE the app shell and auth guard so the mobile app can open
 * it in a browser: it accepts `?token=<jwt>` (stored, then stripped from the
 * URL/history), loads the report's template-schema snapshot, renders it with
 * Form.io, autosaves drafts and validates on submit.
 */
@Component({
  selector: 'app-report-fill',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="fill-shell">
      <header class="bar">
        <div class="bar-id">
          <button class="btn-back" type="button" (click)="goBack()" title="Back">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <mat-icon class="logo">fact_check</mat-icon>
          <div class="titles">
            <h1>{{ report?.templateName || 'QC Report' }}</h1>
            <p class="ctx">
              @if (report) {
                <span class="num">{{ report.number }}</span>
                @if (report.orderNumber) { <span>· {{ report.orderNumber }}</span> }
                @if (report.itemMark) { <span>· {{ report.itemMark }}</span> }
                @if (report.projectName) { <span>· {{ report.projectName }}</span> }
              }
            </p>
          </div>
        </div>
        <div class="bar-actions">
          @if (report) { <span class="pill st-{{ report.status }}">{{ report.status === 'submitted' ? 'Submitted' : 'Draft' }}</span> }
          @if (savedAt && !dirty) { <span class="saved"><mat-icon>cloud_done</mat-icon>Saved {{ savedAt | date:'shortTime' }}</span> }
          @if (dirty) { <span class="saved dirty"><mat-icon>cloud_upload</mat-icon>Unsaved changes</span> }
          <button class="btn ghost" [disabled]="busy || !dirty" (click)="saveDraft()">Save draft</button>
          <button class="btn primary" [disabled]="busy" (click)="submit()">{{ report?.status === 'submitted' ? 'Update submission' : 'Submit report' }}</button>
        </div>
      </header>

      @if (error) { <p class="banner err"><mat-icon>error</mat-icon>{{ error }}</p> }
      @if (notice) { <p class="banner ok"><mat-icon>check_circle</mat-icon>{{ notice }} <a routerLink="/quality-reports">All reports</a></p> }

      <main class="paper">
        @if (loading) {
          <div class="center"><mat-spinner diameter="34"></mat-spinner><span>Loading report…</span></div>
        }
        <div #formHost class="form-host" [class.hidden]="loading"></div>
      </main>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: var(--clay-bg, #f1f5f9); }
    .fill-shell { max-width: 900px; margin: 0 auto; padding: 16px 16px 48px; }
    .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 18px; background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 12px; box-shadow: 0 1px 3px rgba(15,23,42,.06); position: sticky; top: 10px; z-index: 20; }
    .bar-id { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .btn-back { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 9px; border: 1px solid var(--clay-border, #e2e8f0); background: var(--clay-surface, #fff); color: var(--clay-text-secondary, #475569); cursor: pointer; flex-shrink: 0; }
    .btn-back:hover { border-color: var(--clay-primary, #2563eb); color: var(--clay-primary, #2563eb); }
    .btn-back mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .logo { color: var(--clay-primary, #2563eb); font-size: 28px; width: 28px; height: 28px; }
    .titles h1 { margin: 0; font-size: 17px; font-weight: 700; color: var(--clay-text, #0f172a); }
    .ctx { margin: 2px 0 0; font-size: 12px; color: var(--clay-text-muted, #64748b); display: flex; gap: 6px; flex-wrap: wrap; }
    .ctx .num { font-family: 'Space Grotesk', monospace; font-weight: 700; color: var(--clay-text-secondary, #475569); }
    .bar-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .pill { padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .st-draft { background: #fef3c7; color: #92400e; }
    .st-submitted { background: #dcfce7; color: #166534; }
    .saved { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--clay-text-muted, #64748b); }
    .saved.dirty { color: #b45309; }
    .saved mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; border: 1px solid var(--clay-border, #e2e8f0); }
    .btn.ghost { background: var(--clay-surface, #fff); color: var(--clay-text-secondary, #475569); }
    .btn.primary { background: var(--clay-primary, #2563eb); color: #fff; border-color: var(--clay-primary, #2563eb); }
    .btn:disabled { opacity: .55; cursor: default; }
    .banner { display: flex; align-items: center; gap: 8px; border-radius: 10px; padding: 11px 14px; font-size: 13px; margin: 12px 0 0; }
    .banner mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .banner.err { background: #fee2e2; color: #991b1b; }
    .banner.ok { background: #dcfce7; color: #166534; }
    .banner.ok a { color: #166534; font-weight: 700; margin-left: 6px; }
    .paper { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 12px; margin-top: 12px; padding: 22px 24px; box-shadow: 0 1px 3px rgba(15,23,42,.06); }
    .center { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 56px 0; color: var(--clay-text-muted, #64748b); font-size: 13px; }
    .form-host.hidden { display: none; }
    @media (max-width: 640px) { .fill-shell { padding: 8px 8px 32px; } .paper { padding: 14px; } .bar { position: static; } }

    /* ── Clay styling for the rendered Form.io fields (on top of Bootstrap) ── */
    :host ::ng-deep .form-host { font-size: 14px; color: var(--clay-text, #0f172a); }
    :host ::ng-deep .form-host .formio-component { margin-bottom: 18px; }
    :host ::ng-deep .form-host label.col-form-label,
    :host ::ng-deep .form-host label { font-size: 12.5px; font-weight: 600; color: var(--clay-text-secondary, #475569); margin-bottom: 6px; }
    :host ::ng-deep .form-host .field-required:after { color: var(--danger, #dc2626); }
    :host ::ng-deep .form-host .form-control {
      border: 1px solid var(--clay-border, #e2e8f0); border-radius: 9px; padding: 10px 12px;
      font-size: 14px; color: var(--clay-text, #0f172a); background: #fff; height: auto;
      transition: border-color .15s, box-shadow .15s; font-family: inherit;
    }
    :host ::ng-deep .form-host .form-control:focus {
      border-color: var(--clay-primary, #2563eb);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--clay-primary, #2563eb) 18%, transparent);
      outline: none;
    }
    :host ::ng-deep .form-host textarea.form-control { min-height: 92px; }
    :host ::ng-deep .form-host .form-check-input { width: 17px; height: 17px; margin-top: 2px; accent-color: var(--clay-primary, #2563eb); }
    :host ::ng-deep .form-host .form-check-label { font-size: 14px; font-weight: 500; color: var(--clay-text, #0f172a); }
    /* choices.js select widget */
    :host ::ng-deep .form-host .choices__inner {
      border: 1px solid var(--clay-border, #e2e8f0); border-radius: 9px; background: #fff;
      padding: 6px 10px; min-height: 42px; font-size: 14px;
    }
    :host ::ng-deep .form-host .is-focused .choices__inner,
    :host ::ng-deep .form-host .is-open .choices__inner {
      border-color: var(--clay-primary, #2563eb);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--clay-primary, #2563eb) 18%, transparent);
    }
    :host ::ng-deep .form-host .choices__list--dropdown { border-radius: 9px; border-color: var(--clay-border, #e2e8f0); box-shadow: 0 8px 24px rgba(15,23,42,.12); }
    :host ::ng-deep .form-host .choices__list--dropdown .choices__item--selectable.is-highlighted { background: color-mix(in srgb, var(--clay-primary, #2563eb) 10%, #fff); }
    /* validation */
    :host ::ng-deep .form-host .formio-errors .error,
    :host ::ng-deep .form-host .invalid-feedback { color: var(--danger-text, #b91c1c); font-size: 12px; font-weight: 600; }
    :host ::ng-deep .form-host .has-error .form-control,
    :host ::ng-deep .form-host .formio-error-wrapper .form-control { border-color: var(--danger, #dc2626); }
    /* template-embedded buttons follow the app's primary */
    :host ::ng-deep .form-host .btn-primary {
      background: var(--clay-primary, #2563eb); border-color: var(--clay-primary, #2563eb);
      border-radius: 9px; font-weight: 600; padding: 9px 18px;
    }
    :host ::ng-deep .form-host .alert { border-radius: 9px; }
  `],
})
export class ReportFillComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private svc = inject(QualityReportsService);
  private zone = inject(NgZone);

  @ViewChild('formHost', { static: true }) formHost!: ElementRef<HTMLDivElement>;

  report: QualityReport | null = null;
  loading = true;
  busy = false;
  dirty = false;
  savedAt: Date | null = null;
  error: string | null = null;
  notice: string | null = null;

  private form: any = null;
  private static formioPromise: Promise<any> | null = null;

  ngOnInit(): void {
    // Mobile hand-off: ?token=<jwt> → store for the API interceptor, then
    // scrub it from the URL and history.
    const token = this.route.snapshot.queryParamMap.get('token');
    if (token) {
      localStorage.setItem('pcs_token', token);
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      history.replaceState({}, '', url.toString());
    }
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.svc.get(id).subscribe({
      next: (r) => { this.report = r; this.mountForm(); },
      error: (e) => {
        this.loading = false;
        this.error = e?.status === 401
          ? 'Your session has expired — open the report again from the app, or sign in to the portal.'
          : (e?.error?.message || 'Could not load this report.');
      },
    });
  }

  /** In-app navigation → go back in history; opened directly (new tab / QR
   *  scan / mobile hand-off) → there is no history, fall back to the list. */
  goBack(): void {
    if (window.history.length > 1) this.location.back();
    else this.router.navigateByUrl('/quality-reports');
  }

  ngOnDestroy(): void {
    try { this.form?.destroy?.(true); } catch { /* ignore */ }
    document.getElementById('formio-css')?.remove();
    document.getElementById('bootstrap-css')?.remove();
    document.body.style.removeProperty('font-family');
  }

  private async mountForm(): Promise<void> {
    if (!this.report) return;
    try {
      const Formio = await this.ensureFormio();
      this.attachCss();
      const schema = this.report.templateSchema ?? { components: [] };
      const form = await Formio.createForm(this.formHost.nativeElement, schema, { noAlerts: true });
      this.form = form;
      if (this.report.data) form.submission = { data: this.report.data };
      // Ignore the change events fired while the saved data is applied.
      let tracking = false;
      setTimeout(() => { tracking = true; }, 400);
      form.on('change', (ev: any) => {
        if (tracking && ev?.changed) this.zone.run(() => { this.dirty = true; this.notice = null; });
      });
      // Templates may include their own Submit button — honor it.
      form.on('submit', () => this.zone.run(() => this.persist('submitted')));
      this.loading = false;
    } catch {
      this.loading = false;
      this.error = 'Could not load the form renderer (network/offline). Please try again.';
    }
  }

  saveDraft(): void {
    if (!this.report || this.busy) return;
    this.persist('draft');
  }

  submit(): void {
    if (!this.report || this.busy || !this.form) return;
    const data = this.form.submission?.data ?? {};
    const valid = this.form.checkValidity(data, true);
    if (!valid) {
      this.error = 'Some required fields are missing or invalid — they are highlighted below.';
      return;
    }
    this.persist('submitted');
  }

  private persist(status: 'draft' | 'submitted'): void {
    if (!this.report) return;
    this.busy = true; this.error = null; this.notice = null;
    const data = this.form?.submission?.data ?? this.report.data ?? {};
    this.svc.update(this.report.id, { data, status }).subscribe({
      next: (r) => {
        this.busy = false; this.dirty = false; this.savedAt = new Date();
        this.report = { ...this.report!, status: r.status, submittedAt: r.submittedAt };
        if (status === 'submitted') this.notice = `${this.report.number} submitted.`;
      },
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not save the report.'; },
    });
  }

  private ensureFormio(): Promise<any> {
    const w = window as any;
    if (w.Formio) return Promise.resolve(w.Formio);
    if (ReportFillComponent.formioPromise) return ReportFillComponent.formioPromise;
    ReportFillComponent.formioPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = FORMIO_JS;
      script.async = true;
      script.onload = () => (w.Formio ? resolve(w.Formio) : reject(new Error('Formio global missing')));
      script.onerror = () => { ReportFillComponent.formioPromise = null; reject(new Error('Formio CDN load failed')); };
      document.head.appendChild(script);
    });
    return ReportFillComponent.formioPromise;
  }

  /** Bootstrap 4 (the base Form.io's templates are built on) + Form.io CSS.
   *  The app's font is pinned with an inline style so the page keeps its look. */
  private attachCss(): void {
    if (!document.getElementById('bootstrap-css')) {
      const prevFont = getComputedStyle(document.body).fontFamily;
      const bs = document.createElement('link');
      bs.id = 'bootstrap-css';
      bs.rel = 'stylesheet';
      bs.href = BOOTSTRAP_CSS;
      document.head.appendChild(bs);
      document.body.style.fontFamily = prevFont;
    }
    if (document.getElementById('formio-css')) return;
    const link = document.createElement('link');
    link.id = 'formio-css';
    link.rel = 'stylesheet';
    link.href = FORMIO_CSS;
    document.head.appendChild(link);
  }
}
