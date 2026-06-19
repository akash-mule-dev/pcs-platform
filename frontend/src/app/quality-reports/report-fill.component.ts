import { Component, OnInit, OnDestroy, ViewChild, ElementRef, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { QualityReportsService, QualityReport, NcrEvent } from '../core/services/quality-reports.service';
import { ToastService } from '../core/services/toast.service';

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
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule, MatProgressSpinnerModule],
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
          @if (report?.templateType === 'ncr') {
            <span class="pill ncr-st-{{ ncrStatusKey() }}">{{ ncrStatusLabel() }}</span>
          }
          @if (report) {
            <button class="btn ghost" [disabled]="busy || loading" (click)="downloadPdf()" title="Download this report as a PDF">
              <mat-icon>download</mat-icon>PDF
            </button>
          }
          <button class="btn ghost" [disabled]="busy || !dirty" (click)="saveDraft()">Save draft</button>
          <button class="btn primary" [disabled]="busy" (click)="submit()">{{ report?.status === 'submitted' ? 'Update submission' : 'Submit report' }}</button>
        </div>
      </header>

      @if (error) { <p class="banner err"><mat-icon>error</mat-icon>{{ error }}</p> }
      @if (notice) { <p class="banner ok"><mat-icon>check_circle</mat-icon>{{ notice }} <a routerLink="/quality-reports">All reports</a></p> }
      @if (report?.templateType === 'ncr' && !report?.resolvedAt) {
        <p class="banner ncr-open">
          <mat-icon>report_problem</mat-icon>
          This NCR is open — it blocks shipping and quality-stage completion for {{ report?.itemMark || 'this assembly' }} until it is closed.
        </p>
      }

      @if (report?.templateType === 'ncr') {
        <section class="ncr">
          <div class="ncr-row">
            <h2><mat-icon>assignment_late</mat-icon> Non-conformance</h2>
            <span class="pill ncr-st-{{ ncrStatusKey() }}">{{ ncrStatusLabel() }}</span>
            @if (severity()) { <span class="sev sev-{{ severityKey() }}">{{ severity() }}</span> }
            <span class="spacer"></span>
            @if (canEdit()) {
              @if (report?.ncrStatus === 'open') {
                <button class="btn ghost sm" [disabled]="busy" (click)="startReview()"><mat-icon>search</mat-icon>Investigate</button>
              }
              <button class="btn resolve sm" [disabled]="busy || !report?.disposition" [title]="closeHint()" (click)="closeNcr()"><mat-icon>check_circle</mat-icon>Close NCR</button>
              <button class="btn ghost sm danger" [disabled]="busy" (click)="cancelNcr()" title="Raised in error"><mat-icon>block</mat-icon>Cancel</button>
            } @else if (report?.ncrStatus === 'closed') {
              <button class="btn ghost sm" [disabled]="busy" (click)="reopenNcr()"><mat-icon>lock_open</mat-icon>Reopen</button>
            }
          </div>

          <div class="ncr-card">
            <div class="ncr-card-h"><mat-icon>gavel</mat-icon> Disposition</div>
            @if (report?.disposition) {
              <p class="disp"><strong>{{ dispositionLabel(report?.disposition) }}</strong>
                @if (report?.dispositionByName) { <span class="muted"> · {{ report?.dispositionByName }}</span> }
                @if (report?.dispositionAt) { <span class="muted"> · {{ report?.dispositionAt | date:'MMM d, HH:mm' }}</span> }
              </p>
              @if (report?.dispositionNotes) { <p class="disp-note">{{ report?.dispositionNotes }}</p> }
              @if (report?.rootCause) { <p class="kv"><span>Root cause</span>{{ report?.rootCause }}</p> }
              @if (report?.correctiveAction) { <p class="kv"><span>Corrective action</span>{{ report?.correctiveAction }}</p> }
            }
            @if (canEdit()) {
              <div class="disp-form">
                <label class="fld">{{ report?.disposition ? 'Revise disposition' : 'Decide disposition' }}
                  <select [(ngModel)]="dispForm.disposition">
                    <option value="">— choose —</option>
                    @for (d of dispositions; track d.value) { <option [value]="d.value">{{ d.label }}</option> }
                  </select>
                </label>
                <textarea [(ngModel)]="dispForm.notes" rows="2" placeholder="Justification / rework instructions / concession reference"></textarea>
                <div class="two">
                  <textarea [(ngModel)]="dispForm.rootCause" rows="2" placeholder="Root cause (investigation finding)"></textarea>
                  <textarea [(ngModel)]="dispForm.correctiveAction" rows="2" placeholder="Corrective action taken / planned"></textarea>
                </div>
                <div class="disp-actions">
                  <button class="btn primary sm" [disabled]="busy || !dispForm.disposition" (click)="recordDisposition()">
                    <mat-icon>save</mat-icon>{{ report?.disposition ? 'Update disposition' : 'Record disposition' }}
                  </button>
                  @if (needsReinspection()) { <span class="hint"><mat-icon>info</mat-icon>Rework/repair must pass a re-inspection (recorded after this disposition) before the NCR can close.</span> }
                </div>
              </div>
            }
          </div>

          <div class="ncr-card">
            <div class="ncr-card-h"><mat-icon>forum</mat-icon> Activity</div>
            <div class="timeline">
              @for (e of events; track e.id) {
                <div class="ev">
                  <span class="ev-ic ev-{{ e.type }}"><mat-icon>{{ eventIcon(e) }}</mat-icon></span>
                  <div class="ev-body">
                    <span class="ev-t">{{ eventLabel(e) }}</span>
                    @if (e.note) { <span class="ev-note">“{{ e.note }}”</span> }
                    <span class="ev-meta">{{ e.createdByName || 'Someone' }} · {{ e.createdAt | date:'MMM d, HH:mm' }}</span>
                  </div>
                </div>
              } @empty { <p class="muted sm">No activity yet.</p> }
            </div>
            <div class="comment">
              <input [(ngModel)]="commentText" placeholder="Add a comment…" (keydown.enter)="addComment()">
              <button class="btn ghost sm" [disabled]="busy || !commentText.trim()" (click)="addComment()"><mat-icon>send</mat-icon></button>
            </div>
          </div>
        </section>
      }

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
    .banner.ncr-open { background: #fef3c7; color: #92400e; }

    /* NCR resolve / resolved controls */
    .btn.resolve { background: #dcfce7; color: #166534; border-color: #86efac; }
    .btn.resolve:hover:not(:disabled) { background: #bbf7d0; }
    .pill.resolved { display: inline-flex; align-items: center; gap: 4px; background: #dcfce7; color: #166534; }
    .pill.resolved mat-icon { font-size: 15px; width: 15px; height: 15px; }

    /* ── NCR lifecycle panel ── */
    .btn.sm { padding: 7px 12px; font-size: 12.5px; }
    .btn.sm mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .btn.danger { color: var(--danger, #dc2626); }
    .ncr-st-open { background: #fef3c7; color: #92400e; }
    .ncr-st-under_review { background: #dbeafe; color: #1e40af; }
    .ncr-st-dispositioned { background: #ede9fe; color: #6d28d9; }
    .ncr-st-closed { background: #dcfce7; color: #166534; }
    .ncr-st-cancelled { background: #f1f5f9; color: #475569; }
    .sev { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: capitalize; }
    .sev-low { background:#dcfce7; color:#166534; } .sev-medium { background:#fef3c7; color:#92400e; }
    .sev-high { background:#ffedd5; color:#9a3412; } .sev-critical { background:#fee2e2; color:#991b1b; }
    .ncr { background: var(--clay-surface,#fff); border: 1px solid var(--clay-border,#e2e8f0); border-radius: 12px; margin-top: 12px; padding: 16px 18px; box-shadow: 0 1px 3px rgba(15,23,42,.06); }
    .ncr-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ncr-row h2 { display: inline-flex; align-items: center; gap: 8px; margin: 0; font-size: 16px; font-weight: 700; color: var(--clay-text,#0f172a); }
    .ncr-row h2 mat-icon { color: var(--danger,#dc2626); }
    .spacer { flex: 1; }
    .ncr-card { margin-top: 12px; border: 1px solid var(--clay-border,#e2e8f0); border-radius: 10px; padding: 12px 14px; background: var(--clay-bg-warm,#f8fafc); }
    .ncr-card-h { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--clay-text-muted,#64748b); margin-bottom: 8px; }
    .ncr-card-h mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .disp { margin: 0 0 4px; font-size: 14px; color: var(--clay-text,#0f172a); }
    .disp-note { margin: 0 0 8px; font-size: 13px; color: var(--clay-text-secondary,#475569); white-space: pre-wrap; }
    .kv { margin: 4px 0; font-size: 13px; color: var(--clay-text-secondary,#475569); }
    .kv span { display: inline-block; min-width: 120px; font-weight: 700; color: var(--clay-text-muted,#64748b); }
    .muted { color: var(--clay-text-muted,#64748b); } .sm { font-size: 12.5px; }
    .disp-form { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary,#475569); }
    .ncr select, .ncr textarea, .ncr input { border: 1px solid var(--clay-border,#e2e8f0); border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; color: var(--clay-text,#0f172a); background: #fff; }
    .ncr textarea { resize: vertical; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .disp-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .hint { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--clay-text-muted,#64748b); }
    .hint mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .timeline { display: flex; flex-direction: column; gap: 10px; }
    .ev { display: flex; gap: 10px; align-items: flex-start; }
    .ev-ic { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 999px; background: #e2e8f0; color: #475569; flex-shrink: 0; }
    .ev-ic mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .ev-disposition { background:#ede9fe; color:#6d28d9; } .ev-resolved { background:#dcfce7; color:#166534; }
    .ev-cancelled { background:#fee2e2; color:#991b1b; } .ev-comment { background:#dbeafe; color:#1e40af; }
    .ev-body { display: flex; flex-direction: column; gap: 1px; }
    .ev-t { font-size: 13px; font-weight: 600; color: var(--clay-text,#0f172a); }
    .ev-note { font-size: 13px; color: var(--clay-text-secondary,#475569); font-style: italic; }
    .ev-meta { font-size: 11px; color: var(--clay-text-muted,#64748b); }
    .comment { display: flex; gap: 8px; margin-top: 12px; }
    .comment input { flex: 1; }
    @media (max-width: 640px) { .two { grid-template-columns: 1fr; } }
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
    /* checkbox / radio rows — Bootstrap 4 absolutely-positions .form-check-input
       (margin-left:-1.25rem) which collapses the gap to the label here; pin it
       back into flow and use flex+gap so control and label are always spaced. */
    :host ::ng-deep .form-host .form-check { display: flex; align-items: center; gap: 8px; padding-left: 0; margin-bottom: 6px; }
    :host ::ng-deep .form-host .form-check-input {
      position: static; margin: 0; flex-shrink: 0;
      width: 17px; height: 17px; accent-color: var(--clay-primary, #2563eb);
    }
    :host ::ng-deep .form-host .form-check-label {
      display: inline-flex; align-items: center; gap: 8px; margin-bottom: 0;
      font-size: 14px; font-weight: 500; color: var(--clay-text, #0f172a);
    }
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
  private toast = inject(ToastService);

  @ViewChild('formHost', { static: true }) formHost!: ElementRef<HTMLDivElement>;

  report: QualityReport | null = null;
  loading = true;
  busy = false;
  dirty = false;
  savedAt: Date | null = null;
  error: string | null = null;
  notice: string | null = null;

  // NCR lifecycle
  events: NcrEvent[] = [];
  commentText = '';
  dispForm = { disposition: '', notes: '', rootCause: '', correctiveAction: '' };
  readonly dispositions = [
    { value: 'rework', label: 'Rework (restore to full conformance)' },
    { value: 'repair', label: 'Repair (acceptable, not to full spec)' },
    { value: 'use_as_is', label: 'Use as-is (concession)' },
    { value: 'scrap', label: 'Scrap' },
    { value: 'return_to_supplier', label: 'Return to supplier' },
  ];

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
      next: (r) => { this.report = r; this.prefillNcr(); this.mountForm(); },
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
        if (status === 'submitted') { this.notice = `${this.report.number} submitted.`; this.toast.success(`${this.report.number} submitted`); }
        else this.toast.success('Draft saved');
      },
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not save the report.'; },
    });
  }

  // ── Download PDF ───────────────────────────────────────────────────────
  /** Render the filled report into a print-optimized popup → browser "Save as
   *  PDF" (the repo's document convention; no server-side PDF lib). Uses the
   *  LIVE form data so unsaved edits are captured too. */
  downloadPdf(): void {
    if (!this.report) return;
    const data = this.form?.submission?.data ?? this.report.data ?? {};
    const schema = this.report.templateSchema ?? { components: [] };
    const items: { kind: 'section' | 'field'; label: string; value?: string }[] = [];
    this.collectFields(schema['components'] ?? [], data, items);

    const w = window.open('', '_blank');
    if (!w) { this.error = 'Pop-up blocked — allow pop-ups for this site to download the PDF.'; return; }
    w.document.write(this.reportHtml(items));
    w.document.close();
    w.focus();
    // Give the new document a tick to lay out (and load any web fonts) before printing.
    setTimeout(() => { try { w.print(); } catch { /* user can use the in-page button */ } }, 350);
  }

  /** Walk the Form.io component tree (incl. layout containers) into a flat list
   *  of section headings + label/value field rows, resolved against `data`. */
  private collectFields(components: any[], data: any, out: { kind: 'section' | 'field'; label: string; value?: string }[]): void {
    for (const c of components ?? []) {
      if (!c || c.type === 'button' || c.type === 'content' || c.type === 'htmlelement') continue;
      switch (c.type) {
        case 'panel': case 'fieldset': case 'well': {
          const heading = c.title || c.legend || c.label;
          if (heading && c.type !== 'well') out.push({ kind: 'section', label: heading });
          this.collectFields(c.components ?? [], data, out);
          continue;
        }
        case 'columns':
          for (const col of c.columns ?? []) this.collectFields(col.components ?? [], data, out);
          continue;
        case 'table':
          for (const row of c.rows ?? []) for (const cell of row ?? []) this.collectFields(cell.components ?? [], data, out);
          continue;
        case 'tabs':
          for (const tab of c.components ?? []) {
            if (tab.label) out.push({ kind: 'section', label: tab.label });
            this.collectFields(tab.components ?? [], data, out);
          }
          continue;
        case 'container':
          this.collectFields(c.components ?? [], data?.[c.key] ?? data, out);
          continue;
        case 'datagrid': case 'editgrid': {
          if (c.label) out.push({ kind: 'section', label: c.label });
          const rows = Array.isArray(data?.[c.key]) ? data[c.key] : [];
          rows.forEach((row: any, i: number) => {
            out.push({ kind: 'section', label: `${c.label || c.key} — row ${i + 1}` });
            this.collectFields(c.components ?? [], row, out);
          });
          continue;
        }
      }
      if (c.input === false || !c.key) continue;
      out.push({ kind: 'field', label: c.label || c.key, value: this.formatValue(c, data?.[c.key]) });
    }
  }

  /** Human-readable value for a single component, mapping option values → labels. */
  private formatValue(c: any, raw: any): string {
    switch (c.type) {
      case 'checkbox':
        return raw ? '☑ Yes' : '☐ No';
      case 'selectboxes': {
        const checked = Object.entries(raw ?? {}).filter(([, v]) => v).map(([k]) => k);
        const labels = (c.values ?? []).filter((o: any) => checked.includes(o.value)).map((o: any) => o.label);
        const known = new Set((c.values ?? []).map((o: any) => o.value));
        const extra = checked.filter((k) => !known.has(k));
        const all = [...labels, ...extra];
        return all.length ? all.join(', ') : '—';
      }
      case 'radio': {
        const opt = (c.values ?? []).find((o: any) => o.value === raw);
        return opt ? opt.label : (raw != null && raw !== '' ? String(raw) : '—');
      }
      case 'select': {
        const vals = c.data?.values ?? c.data?.json ?? [];
        const opt = Array.isArray(vals) ? vals.find((o: any) => o.value === raw) : null;
        if (opt) return opt.label;
        if (Array.isArray(raw)) return raw.length ? raw.map((x) => (x?.label ?? x)).join(', ') : '—';
        if (raw && typeof raw === 'object') return raw.label || JSON.stringify(raw);
        return raw != null && raw !== '' ? String(raw) : '—';
      }
      case 'datetime': case 'day': {
        if (!raw) return '—';
        const d = new Date(raw);
        return isNaN(d.getTime()) ? String(raw) : d.toLocaleString();
      }
    }
    if (Array.isArray(raw)) return raw.length ? raw.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : '—';
    if (raw && typeof raw === 'object') return JSON.stringify(raw);
    return raw != null && raw !== '' ? String(raw) : '—';
  }

  private esc(v: unknown): string {
    return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  }

  private reportHtml(items: { kind: 'section' | 'field'; label: string; value?: string }[]): string {
    const r = this.report!;
    const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const meta = [
      ['Project', r.projectName],
      ['Order', r.orderNumber],
      ['Item / Mark', r.itemMark],
      ['Customer', r.customerName],
      ['Status', r.status === 'submitted' ? 'Submitted' : 'Draft'],
      ['Date', fmtDate(r.submittedAt || r.updatedAt)],
    ].filter(([, v]) => v != null && v !== '')
      .map(([l, v]) => `<div class="row"><span class="lbl">${this.esc(l)}</span><span class="val">${this.esc(v)}</span></div>`)
      .join('');

    const body = items.map((it) => it.kind === 'section'
      ? `<tr class="sec"><td colspan="2">${this.esc(it.label)}</td></tr>`
      : `<tr><td class="k">${this.esc(it.label)}</td><td class="v">${this.esc(it.value)}</td></tr>`,
    ).join('') || `<tr><td colspan="2" class="empty">No fields recorded.</td></tr>`;

    return `<!doctype html><html><head><meta charset="utf-8">
<title>${this.esc(r.number)} — ${this.esc(r.templateName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a2b34; margin: 32px; font-size: 12px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #123; padding-bottom: 14px; }
  .org { font-size: 20px; font-weight: 800; letter-spacing: -0.3px; }
  .doc-title { text-align: right; }
  .doc-title h1 { margin: 0; font-size: 20px; letter-spacing: 1px; color: #123; text-transform: uppercase; }
  .doc-title .num { font-size: 15px; font-weight: 700; margin-top: 2px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 18px 0 22px; }
  .meta .row { display: flex; gap: 8px; }
  .meta .lbl { color: #6b7c85; font-weight: 600; min-width: 96px; text-transform: uppercase; font-size: 10px; letter-spacing: .5px; padding-top: 1px; }
  .meta .val { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 7px 10px; border-bottom: 1px solid #dde3e6; vertical-align: top; }
  td.k { width: 42%; color: #44555e; font-weight: 600; }
  td.v { font-weight: 600; }
  tr.sec td { background: #123; color: #fff; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; font-weight: 700; padding: 6px 10px; }
  td.empty { text-align: center; color: #93a2a8; padding: 22px; }
  .toolbar { margin-bottom: 16px; }
  .toolbar button { font: inherit; font-weight: 600; padding: 8px 16px; border: 1px solid #123; background: #123; color: #fff; border-radius: 8px; cursor: pointer; }
  .foot { margin-top: 26px; font-size: 9.5px; color: #93a2a8; text-align: center; }
  @media print { body { margin: 14mm; } .noprint { display: none; } }
</style></head><body>
  <div class="toolbar noprint"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
  <div class="top">
    <div><div class="org">${this.esc(r.templateName)}</div><div style="color:#6b7c85;margin-top:2px">Quality Control Report</div></div>
    <div class="doc-title"><h1>QC Report</h1><div class="num">${this.esc(r.number)}</div></div>
  </div>
  <div class="meta">${meta}</div>
  <table><tbody>${body}</tbody></table>
  <div class="foot">Generated ${new Date().toLocaleString()}</div>
</body></html>`;
  }

  // ── NCR lifecycle ──────────────────────────────────────────────────────
  private prefillNcr(): void {
    if (this.report?.templateType !== 'ncr') return;
    this.dispForm = {
      disposition: this.report.disposition ?? '',
      notes: this.report.dispositionNotes ?? '',
      rootCause: this.report.rootCause ?? '',
      correctiveAction: this.report.correctiveAction ?? '',
    };
    this.loadEvents();
  }

  private loadEvents(): void {
    if (this.report?.templateType !== 'ncr') return;
    this.svc.events(this.report.id).subscribe({ next: (e) => (this.events = e), error: () => {} });
  }

  ncrStatusKey(): string { return this.report?.ncrStatus || (this.report?.resolvedAt ? 'closed' : 'open'); }
  ncrStatusLabel(): string {
    return ({ open: 'Open', under_review: 'Under review', dispositioned: 'Dispositioned', closed: 'Closed', cancelled: 'Cancelled' } as Record<string, string>)[this.ncrStatusKey()] ?? 'Open';
  }
  canEdit(): boolean {
    const k = this.ncrStatusKey();
    return this.report?.templateType === 'ncr' && k !== 'closed' && k !== 'cancelled';
  }
  severity(): string | null { const s = this.report?.data?.['severity']; return s ? String(s) : null; }
  severityKey(): string { return (this.severity() ?? '').toLowerCase(); }
  dispositionLabel(d: string | null | undefined): string { return this.dispositions.find((x) => x.value === d)?.label ?? (d ?? '—'); }
  needsReinspection(): boolean { return this.dispForm.disposition === 'rework' || this.dispForm.disposition === 'repair'; }
  closeHint(): string { return this.report?.disposition ? 'Close this NCR — lifts the shipping + quality-stage gates' : 'Record a disposition before closing'; }
  eventIcon(e: NcrEvent): string {
    return ({ created: 'flag', submitted: 'task_alt', disposition: 'gavel', resolved: 'check_circle', reopened: 'lock_open', cancelled: 'block', comment: 'chat_bubble' } as Record<string, string>)[e.type] ?? 'radio_button_checked';
  }
  eventLabel(e: NcrEvent): string {
    switch (e.type) {
      case 'created': return 'NCR raised';
      case 'submitted': return 'Report submitted';
      case 'disposition': return `Disposition: ${this.dispositionLabel(e.disposition)}`;
      case 'resolved': return 'Closed — gates lifted';
      case 'reopened': return 'Reopened';
      case 'cancelled': return 'Cancelled (raised in error)';
      case 'comment': return 'Comment';
      case 'status': return e.toStatus === 'under_review' ? 'Investigation started' : `Status → ${e.toStatus}`;
      default: return e.type;
    }
  }

  recordDisposition(): void {
    if (!this.report || this.busy || !this.dispForm.disposition) return;
    this.busy = true; this.error = null;
    this.svc.disposition(this.report.id, {
      disposition: this.dispForm.disposition,
      dispositionNotes: this.dispForm.notes || undefined,
      rootCause: this.dispForm.rootCause || undefined,
      correctiveAction: this.dispForm.correctiveAction || undefined,
    }).subscribe({
      next: (r) => this.afterNcrAction(r, 'Disposition recorded'),
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not record the disposition.'; },
    });
  }

  startReview(): void {
    if (!this.report || this.busy) return;
    this.busy = true; this.error = null;
    this.svc.startReview(this.report.id).subscribe({
      next: (r) => this.afterNcrAction(r, 'Marked under review'),
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not update the NCR.'; },
    });
  }

  /** Close (resolve) this NCR — backend enforces disposition + rework re-inspection. */
  closeNcr(): void {
    if (!this.report || this.busy) return;
    this.busy = true; this.error = null;
    this.svc.resolve(this.report.id).subscribe({
      next: (r) => this.afterNcrAction(r, `${r.number} closed — gates lifted`),
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not close this NCR.'; },
    });
  }

  reopenNcr(): void {
    if (!this.report || this.busy) return;
    this.busy = true; this.error = null;
    this.svc.reopen(this.report.id).subscribe({
      next: (r) => this.afterNcrAction(r, `${r.number} reopened`),
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not reopen this NCR.'; },
    });
  }

  cancelNcr(): void {
    if (!this.report || this.busy) return;
    const note = window.prompt('Cancel this NCR (raised in error)? Optional reason:');
    if (note === null) return; // dismissed
    this.busy = true; this.error = null;
    this.svc.cancel(this.report.id, note || undefined).subscribe({
      next: (r) => this.afterNcrAction(r, `${r.number} cancelled`),
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not cancel this NCR.'; },
    });
  }

  addComment(): void {
    if (!this.report || this.busy || !this.commentText.trim()) return;
    const id = this.report.id;
    this.busy = true; this.error = null;
    this.svc.comment(id, this.commentText.trim()).subscribe({
      next: () => { this.busy = false; this.commentText = ''; this.loadEvents(); },
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not add the comment.'; },
    });
  }

  private afterNcrAction(r: QualityReport, msg: string): void {
    this.busy = false;
    this.report = r;
    this.prefillNcr();
    this.toast.success(msg);
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
