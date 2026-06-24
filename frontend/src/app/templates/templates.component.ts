import { Component, OnInit, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TemplatesApiService } from './templates.service';
import { QualityReportsService } from '../core/services/quality-reports.service';
import { TemplateEditorDialogComponent, TemplateDialogData } from './template-editor-dialog.component';
import { TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL } from './template-types';

/**
 * Report templates list — per-customer drag-drop forms (Form.io) that drive QC
 * reports, NCR forms and checklists. This page is purely the list; creating,
 * editing and viewing a template all happen in a dialog
 * (TemplateEditorDialogComponent) opened from here.
 */
@Component({
  selector: 'app-templates',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="page">
      <div class="head">
        <div>
          <h1>Report Templates</h1>
          <p class="sub">Drag-drop forms, customized per customer — they drive QC reports, NCR forms and checklists.</p>
        </div>
        <button class="primary" (click)="create()">
          <mat-icon>add</mat-icon>New template
        </button>
      </div>

      <section class="card list-card">
        @if (templates.length === 0) {
          <div class="none">
            <mat-icon>dashboard_customize</mat-icon>
            <h3>No templates yet</h3>
            <p>Create your first one — drag fields together for a customer's QC report, then it appears in every "Start report" dropdown.</p>
            <button class="primary" (click)="create()"><mat-icon>add</mat-icon>New template</button>
          </div>
        } @else {
          <div class="thead"><span>Name</span><span>Version</span><span>Fields</span><span>Used by</span><span></span></div>
          @for (g of groups(); track g.type) {
            <div class="grp"><span class="type-chip tt-{{ g.type }}">{{ g.label }}</span><span class="grp-count">{{ g.items.length }}</span></div>
            @for (t of g.items; track t.id) {
              <div class="trow">
                <span class="t-name">{{ t.name }}@if (t.libraryOriginId) { <span class="lib-badge" title="Published from the shared library"><mat-icon>auto_awesome</mat-icon>Library</span> }</span>
                <span class="t-ver">v{{ t.version }}</span>
                <span class="t-fields">{{ (t.schema?.components?.length) || 0 }} fields</span>
                <span class="t-use">@if (usage[t.id]) { <span class="use-chip">{{ usage[t.id] }} report{{ usage[t.id] === 1 ? '' : 's' }}</span> } @else { <span class="use-none">unused</span> }</span>
                <span class="t-actions">
                  <button class="link" (click)="view(t)"><mat-icon>visibility</mat-icon>View</button>
                  <button class="link" (click)="edit(t)"><mat-icon>edit</mat-icon>Edit</button>
                  <button class="link danger" (click)="remove(t)" [disabled]="!!usage[t.id]" [attr.aria-label]="usage[t.id] ? 'In use by ' + usage[t.id] + ' report(s) — cannot delete' : 'Delete template'" [title]="usage[t.id] ? 'In use by ' + usage[t.id] + ' report(s) — cannot delete' : 'Delete template'"><mat-icon>delete</mat-icon></button>
                </span>
              </div>
            }
          }
        }
      </section>
    </div>
  `,
  styles: [`
    .page { max-width: 1320px; margin: 0 auto; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .head h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--clay-text); }
    .sub { margin: 4px 0 0; font-size: 13px; color: var(--clay-text-muted); }
    .primary { display: inline-flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; background: var(--clay-primary); color: #fff; border: none; }
    .primary mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); box-shadow: var(--clay-shadow-soft); }
    .list-card { overflow: hidden; }
    .thead, .trow { display: grid; grid-template-columns: 2fr 80px 110px 120px 200px; gap: 12px; align-items: center; padding: 11px 16px; }
    .thead { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); border-bottom: 1px solid var(--clay-border); background: var(--clay-bg-warm); }
    .grp { display: flex; align-items: center; gap: 8px; padding: 9px 16px; border-bottom: 1px solid var(--clay-border); background: var(--clay-bg-warm); }
    .grp-count { font-size: 11px; font-weight: 700; color: var(--clay-text-muted); }
    .lib-badge { display: inline-flex; align-items: center; gap: 3px; margin-left: 8px; padding: 1px 7px; border-radius: 5px; font-size: 10px; font-weight: 700; background: #ede9fe; color: #6d28d9; vertical-align: middle; }
    .lib-badge mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .t-use { font-size: 12px; }
    .use-chip { padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; background: var(--info-bg); color: var(--info-text); }
    .use-none { font-size: 11px; color: var(--clay-text-muted); }
    .link:disabled { opacity: .4; cursor: default; }
    .trow { border-bottom: 1px solid var(--clay-border); }
    .trow:last-child { border-bottom: none; }
    .trow:hover { background: var(--clay-surface-hover); }
    .t-name { font-size: 13px; font-weight: 600; color: var(--clay-text); }
    .type-chip { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .tt-inspection { background: var(--info-bg); color: var(--clay-primary); }
    .tt-checklist { background: var(--success-bg); color: var(--success-text); }
    .tt-ncr { background: var(--danger-bg); color: var(--danger-text); }
    .tt-capa { background: var(--warning-bg); color: var(--warning-text); }
    .tt-other { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .t-ver, .t-fields { font-size: 12px; color: var(--clay-text-muted); font-family: 'Space Grotesk', monospace; }
    .t-actions { display: flex; gap: 6px; justify-content: flex-end; }
    .link { display: inline-flex; align-items: center; gap: 3px; background: none; border: none; color: var(--clay-primary); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; padding: 4px 6px; }
    .link.danger { color: var(--clay-text-muted); }
    .link.danger:hover { color: var(--danger); }
    .link mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .none { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 16px; text-align: center; }
    .none mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--clay-text-muted); opacity: .5; }
    .none h3 { margin: 0; font-size: 16px; color: var(--clay-text); }
    .none p { margin: 0 0 10px; font-size: 13px; color: var(--clay-text-muted); max-width: 460px; }
  `],
})
export class TemplatesComponent implements OnInit {
  private api = inject(TemplatesApiService);
  private qr = inject(QualityReportsService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  readonly types = TEMPLATE_TYPES;
  templates: any[] = [];
  usage: Record<string, number> = {};

  ngOnInit(): void { this.load(); this.loadUsage(); }

  typeLabel(t: string): string { return TEMPLATE_TYPE_LABEL[t] ?? t; }

  load(): void {
    this.api.list().subscribe({ next: (d) => this.templates = Array.isArray(d) ? d : (d?.data || []), error: () => {} });
  }

  /** Count how many reports were filled from each template (for the usage badge). */
  private loadUsage(): void {
    this.qr.list().subscribe({
      next: (reports) => {
        const m: Record<string, number> = {};
        for (const r of reports) if (r.templateId) m[r.templateId] = (m[r.templateId] ?? 0) + 1;
        this.usage = m;
      },
      error: () => {},
    });
  }

  /** Templates grouped by type, in the canonical type order, skipping empty groups. */
  groups(): { type: string; label: string; items: any[] }[] {
    return TEMPLATE_TYPES
      .map((type) => ({ type, label: this.typeLabel(type), items: this.templates.filter((t) => (t.type ?? 'other') === type) }))
      .filter((g) => g.items.length > 0)
      .concat(
        // any unknown/legacy types fall into a trailing bucket (distinct label so it
        // never reads as a duplicate of the canonical "Other" group above)
        this.templates.some((t) => !TEMPLATE_TYPES.includes(t.type ?? 'other'))
          ? [{ type: '_misc', label: 'Other (legacy)', items: this.templates.filter((t) => !TEMPLATE_TYPES.includes(t.type ?? 'other')) }]
          : [],
      );
  }

  create(): void { this.openDialog({ mode: 'create' }); }
  edit(t: any): void { this.openDialog({ mode: 'edit', template: t }); }
  view(t: any): void { this.openDialog({ mode: 'view', template: t, usageCount: this.usage[t.id] }); }

  private openDialog(data: TemplateDialogData): void {
    this.dialog.open(TemplateEditorDialogComponent, {
      data, autoFocus: false,
      width: 'min(1040px, 92vw)', maxWidth: '92vw',
    }).afterClosed().subscribe((saved) => { if (saved) { this.load(); this.loadUsage(); } });
  }

  remove(t: any): void {
    this.api.remove(t.id).subscribe({
      next: () => { this.snack.open('Template deleted', 'OK', { duration: 3000, panelClass: 'success-snackbar' }); this.load(); },
      error: () => {},
    });
  }
}
