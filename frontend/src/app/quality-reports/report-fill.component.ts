import { Component, OnInit, OnDestroy, ViewChild, ElementRef, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { QualityReportsService, QualityReport } from '../core/services/quality-reports.service';
import { NcrApiService, NcrRow } from '../quality-ncr/ncr.service';

type NcrSeverity = 'low' | 'medium' | 'high' | 'critical';

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
          @if (report) {
            <button class="btn ncr" [disabled]="busy" (click)="openNcr()" title="Raise a non-conformance report for this assembly">
              <mat-icon>report_problem</mat-icon>Raise NCR
            </button>
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
      @if (ncrCreated) {
        <p class="banner ncr-ok">
          <mat-icon>report_problem</mat-icon>
          NCR <b>{{ ncrCreated.number }}</b> raised for {{ report?.itemMark || 'this assembly' }}.
          <a routerLink="/ncr">Open NCRs</a>
        </p>
      }

      <main class="paper">
        @if (loading) {
          <div class="center"><mat-spinner diameter="34"></mat-spinner><span>Loading report…</span></div>
        }
        <div #formHost class="form-host" [class.hidden]="loading"></div>
      </main>

      <!-- Raise-NCR dialog: self-contained, links the NCR to this report's assembly -->
      @if (ncrOpen) {
        <div class="ncr-backdrop" (click)="closeNcr()">
          <div class="ncr-modal" (click)="$event.stopPropagation()">
            <div class="ncr-head">
              <h2><mat-icon>report_problem</mat-icon>Raise NCR</h2>
              <button class="ncr-x" type="button" (click)="closeNcr()" title="Close"><mat-icon>close</mat-icon></button>
            </div>
            <p class="ncr-ctx">
              @if (report?.itemMark) { <span class="num">{{ report?.itemMark }}</span> }
              @if (report?.orderNumber) { <span>· {{ report?.orderNumber }}</span> }
              @if (report?.number) { <span>· from {{ report?.number }}</span> }
            </p>

            <label class="ncr-field">
              <span>Title <em>*</em></span>
              <input type="text" [(ngModel)]="ncrForm.title" maxlength="255" placeholder="Short summary of the non-conformance">
            </label>
            <label class="ncr-field">
              <span>Severity</span>
              <select [(ngModel)]="ncrForm.severity">
                @for (s of severities; track s) { <option [value]="s">{{ s | titlecase }}</option> }
              </select>
            </label>
            <label class="ncr-field">
              <span>Description</span>
              <textarea rows="4" [(ngModel)]="ncrForm.description" placeholder="What is wrong, where, and how it was found"></textarea>
            </label>

            @if (ncrError) { <p class="ncr-err"><mat-icon>error</mat-icon>{{ ncrError }}</p> }

            <div class="ncr-actions">
              <button class="btn ghost" type="button" [disabled]="ncrBusy" (click)="closeNcr()">Cancel</button>
              <button class="btn danger" type="button" [disabled]="ncrBusy || !ncrForm.title.trim()" (click)="raiseNcr()">
                @if (ncrBusy) { <mat-spinner diameter="14"></mat-spinner> } @else { <mat-icon>report_problem</mat-icon> }
                <span>Raise NCR</span>
              </button>
            </div>
          </div>
        </div>
      }
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
    .banner.ncr-ok { background: #fef3c7; color: #92400e; }
    .banner.ncr-ok b { font-weight: 800; }
    .banner.ncr-ok a { color: #92400e; font-weight: 700; margin-left: 8px; text-decoration: underline; }

    /* Raise-NCR button + dialog */
    .btn.ncr { background: #fff7ed; color: #b45309; border-color: #fdba74; }
    .btn.ncr:hover:not(:disabled) { background: #ffedd5; }
    .btn.danger { background: #dc2626; color: #fff; border-color: #dc2626; }
    .btn.danger:disabled { opacity: .55; }
    .ncr-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,.5); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 50; }
    .ncr-modal { background: var(--clay-surface, #fff); border-radius: 14px; box-shadow: 0 18px 48px rgba(15,23,42,.28); width: 100%; max-width: 460px; padding: 18px 20px 20px; }
    .ncr-head { display: flex; align-items: center; justify-content: space-between; }
    .ncr-head h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 17px; font-weight: 800; color: var(--clay-text, #0f172a); }
    .ncr-head h2 mat-icon { color: #dc2626; }
    .ncr-x { background: none; border: none; color: var(--clay-text-muted, #64748b); cursor: pointer; padding: 4px; border-radius: 8px; }
    .ncr-x:hover { background: var(--clay-bg, #f1f5f9); }
    .ncr-ctx { margin: 4px 0 14px; font-size: 12px; color: var(--clay-text-muted, #64748b); display: flex; gap: 6px; flex-wrap: wrap; }
    .ncr-ctx .num { font-family: 'Space Grotesk', monospace; font-weight: 700; color: var(--clay-text-secondary, #475569); }
    .ncr-field { display: block; margin-bottom: 12px; }
    .ncr-field > span { display: block; font-size: 12px; font-weight: 700; color: var(--clay-text-secondary, #475569); margin-bottom: 5px; }
    .ncr-field > span em { color: #dc2626; font-style: normal; }
    .ncr-field input, .ncr-field select, .ncr-field textarea {
      width: 100%; box-sizing: border-box; border: 1px solid var(--clay-border, #e2e8f0); border-radius: 9px;
      padding: 9px 11px; font-size: 14px; color: var(--clay-text, #0f172a); background: #fff; font-family: inherit;
    }
    .ncr-field textarea { resize: vertical; min-height: 78px; }
    .ncr-field input:focus, .ncr-field select:focus, .ncr-field textarea:focus {
      border-color: var(--clay-primary, #2563eb); outline: none;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--clay-primary, #2563eb) 18%, transparent);
    }
    .ncr-err { display: flex; align-items: center; gap: 6px; background: #fee2e2; color: #991b1b; border-radius: 9px; padding: 9px 11px; font-size: 12.5px; margin: 0 0 12px; }
    .ncr-err mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .ncr-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
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
  private ncrApi = inject(NcrApiService);
  private zone = inject(NgZone);

  @ViewChild('formHost', { static: true }) formHost!: ElementRef<HTMLDivElement>;

  report: QualityReport | null = null;
  loading = true;
  busy = false;
  dirty = false;
  savedAt: Date | null = null;
  error: string | null = null;
  notice: string | null = null;

  // Raise-NCR dialog state
  readonly severities: NcrSeverity[] = ['low', 'medium', 'high', 'critical'];
  ncrOpen = false;
  ncrBusy = false;
  ncrError: string | null = null;
  ncrCreated: NcrRow | null = null;
  ncrForm: { title: string; severity: NcrSeverity; description: string } = { title: '', severity: 'medium', description: '' };

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

  // ── Raise NCR ──────────────────────────────────────────────────────────
  /** Open the dialog, pre-filling from the report context + the filled form
   *  (an overall "reject" result bumps severity; remarks seed the description). */
  openNcr(): void {
    this.ncrError = null;
    const mark = this.report?.itemMark || this.report?.orderNumber || 'assembly';
    const { result, remarks } = this.readFormFindings();
    const lc = (result ?? '').toLowerCase();
    const severity: NcrSeverity = /reject|fail/.test(lc) ? 'high' : 'medium';
    const parts = [`Raised from QC report ${this.report?.number ?? ''}`.trim() + '.'];
    if (result) parts.push(`Inspection result: ${result}.`);
    if (remarks) parts.push(`Remarks: ${remarks}`);
    this.ncrForm = { title: `QC nonconformance — ${mark}`, severity, description: parts.join(' ') };
    this.ncrOpen = true;
  }

  closeNcr(): void { this.ncrOpen = false; this.ncrBusy = false; }

  raiseNcr(): void {
    if (!this.report || this.ncrBusy) return;
    const title = this.ncrForm.title.trim();
    if (!title) { this.ncrError = 'A title is required.'; return; }
    this.ncrBusy = true;
    this.ncrError = null;
    const body: Record<string, any> = { title, severity: this.ncrForm.severity };
    const desc = this.ncrForm.description.trim();
    if (desc) body['description'] = desc;
    if (this.report.assemblyNodeId) body['assemblyNodeId'] = this.report.assemblyNodeId;
    if (this.report.projectId) body['projectId'] = this.report.projectId;
    this.ncrApi.createNcr(body).subscribe({
      next: (n) => { this.ncrBusy = false; this.ncrOpen = false; this.ncrCreated = n; },
      error: (e) => { this.ncrBusy = false; this.ncrError = e?.error?.message || 'Could not raise the NCR.'; },
    });
  }

  /** Best-effort scrape of the filled form for an overall result + remarks,
   *  matched by key so it works across templates (purely for prefill). */
  private readFormFindings(): { result: string | null; remarks: string | null } {
    let result: string | null = null;
    let remarks: string | null = null;
    try {
      const data = this.form?.submission?.data ?? this.report?.data ?? {};
      for (const [key, val] of Object.entries(data)) {
        if (typeof val !== 'string' || !val.trim()) continue;
        const k = key.toLowerCase();
        if (!result && /(result|disposition|acceptance|conformance)/.test(k)) result = val;
        else if (!remarks && /(remark|observation|comment|note|finding)/.test(k)) remarks = val;
      }
    } catch { /* prefill is optional */ }
    return { result, remarks };
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
