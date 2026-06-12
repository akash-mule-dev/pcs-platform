import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NcrApiService, NcrEventRow, NcrRow } from './ncr.service';
import { PermissionsService } from '../core/services/permissions.service';

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const DISPOSITIONS = ['rework', 'scrap', 'use_as_is', 'return_to_supplier', 'regrade'];
const CAPA_TYPES = ['corrective', 'preventive'];
/** Mirrors backend ncr-workflow.ts CAPA_TRANSITIONS (UI hint only; server enforces). */
const CAPA_NEXT: Record<string, string[]> = {
  open: ['in_progress', 'verified'],
  in_progress: ['verified', 'open'],
  verified: ['closed', 'in_progress'],
  closed: [],
};
const STATUS_LABELS: Record<string, string> = {
  open: 'Open', investigation: 'Investigating', disposition: 'Disposition', closed: 'Closed', cancelled: 'Cancelled',
};
const TRANSITION_VERBS: Record<string, string> = {
  investigation: 'Start investigation', disposition: 'Move to disposition', closed: 'Close NCR', cancelled: 'Cancel NCR',
};

@Component({
  selector: 'app-ncr',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule, MatTooltipModule,
  ],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Non-Conformance (NCR / CAPA)</h1>
          <p class="page-subtitle">Raise, investigate, disposition and drive corrective actions</p>
        </div>
        @if (canCreate) {
          <button mat-raised-button color="primary" (click)="showAdd = !showAdd">
            <mat-icon>add</mat-icon> New NCR
          </button>
        }
      </div>

      @if (showAdd) {
        <div class="panel">
          <h3>Raise an NCR</h3>
          <div class="form-row">
            <mat-form-field appearance="outline" class="grow"><mat-label>Title</mat-label>
              <input matInput [(ngModel)]="newNcr.title"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Severity</mat-label>
              <mat-select [(ngModel)]="newNcr.severity">
                @for (s of severities; track s) { <mat-option [value]="s">{{ s }}</mat-option> }
              </mat-select></mat-form-field>
          </div>
          <mat-form-field appearance="outline" class="full"><mat-label>Description</mat-label>
            <textarea matInput rows="2" [(ngModel)]="newNcr.description"></textarea></mat-form-field>
          <div class="panel-actions">
            <button mat-button (click)="showAdd = false">Cancel</button>
            <button mat-raised-button color="primary" [disabled]="!newNcr.title" (click)="saveNcr()">Raise</button>
          </div>
        </div>
      }

      <!-- Filters -->
      <div class="filters">
        <div class="chip-row">
          @for (f of statusFilters; track f.value) {
            <button class="filter-chip" [class.active]="statusFilter === f.value" (click)="setStatusFilter(f.value)">{{ f.label }}</button>
          }
        </div>
        <mat-form-field appearance="outline" class="sev-filter"><mat-label>Severity</mat-label>
          <mat-select [(ngModel)]="severityFilter" (selectionChange)="load()">
            <mat-option [value]="''">All</mat-option>
            @for (s of severities; track s) { <mat-option [value]="s">{{ s }}</mat-option> }
          </mat-select></mat-form-field>
        <mat-form-field appearance="outline" class="search"><mat-label>Search number / title</mat-label>
          <input matInput [(ngModel)]="search" (keyup.enter)="load()" placeholder="NCR-2026-0001, weld…">
          <button matSuffix mat-icon-button (click)="load()"><mat-icon>search</mat-icon></button>
        </mat-form-field>
      </div>

      @if (loading) {
        <div class="center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else {
        <table mat-table [dataSource]="ncrs" class="mat-elevation-z1 full">
          <ng-container matColumnDef="number"><th mat-header-cell *matHeaderCellDef>Number</th>
            <td mat-cell *matCellDef="let n"><span class="mark">{{ n.number }}</span></td></ng-container>
          <ng-container matColumnDef="title"><th mat-header-cell *matHeaderCellDef>Title</th>
            <td mat-cell *matCellDef="let n">{{ n.title }}</td></ng-container>
          <ng-container matColumnDef="project"><th mat-header-cell *matHeaderCellDef>Project</th>
            <td mat-cell *matCellDef="let n">{{ n.projectName || '—' }}</td></ng-container>
          <ng-container matColumnDef="item"><th mat-header-cell *matHeaderCellDef>Item</th>
            <td mat-cell *matCellDef="let n"><span class="mark">{{ n.itemMark || '—' }}</span></td></ng-container>
          <ng-container matColumnDef="severity"><th mat-header-cell *matHeaderCellDef>Severity</th>
            <td mat-cell *matCellDef="let n"><span class="chip sev-{{n.severity}}">{{ n.severity }}</span></td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let n"><span class="status st-{{n.status}}">{{ statusLabel(n.status) }}</span></td></ng-container>
          <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let n"><button mat-button color="primary" (click)="openDetail(n)">Open</button></td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns" [class.row-selected]="selected?.id === row.id"></tr>
        </table>
        @if (ncrs.length === 0) { <p class="empty">No NCRs match this filter.</p> }
      }

      @if (selected) {
        <div class="panel detail">
          <div class="detail-head">
            <div>
              <h3><span class="mark">{{ selected.number }}</span> — {{ selected.title }}</h3>
              <div class="meta-line">
                <span class="status st-{{selected.status}}">{{ statusLabel(selected.status) }}</span>
                <span class="chip sev-{{selected.severity}}">{{ selected.severity }}</span>
                @if (selected.projectName) { <span class="meta">{{ selected.projectName }}</span> }
                @if (selected.itemMark) { <span class="meta mark">{{ selected.itemMark }}</span> }
                @if (selected.disposition) { <span class="meta"><mat-icon class="mi">gavel</mat-icon>{{ selected.disposition }}</span> }
              </div>
            </div>
            <div class="head-actions">
              <button mat-icon-button matTooltip="Print / save as PDF" (click)="printNcr()"><mat-icon>print</mat-icon></button>
              <button mat-icon-button (click)="closeDetail()"><mat-icon>close</mat-icon></button>
            </div>
          </div>
          @if (selected.description) { <p class="desc">{{ selected.description }}</p> }

          <!-- Photo evidence -->
          @if (evidenceUrls.length || canCreate) {
            <div class="evidence-row">
              @for (url of evidenceUrls; track url) {
                <a [href]="url" target="_blank" rel="noopener"><img [src]="url" alt="NCR evidence" /></a>
              }
              @if (canCreate) {
                <input #photoInput type="file" accept="image/jpeg,image/png,image/webp" hidden (change)="onPhotoPicked($event)">
                <button mat-stroked-button class="attach-btn" [disabled]="busy" (click)="photoInput.click()">
                  <mat-icon>add_a_photo</mat-icon> Photo
                </button>
              }
            </div>
          }

          <!-- Guided workflow -->
          @if (canManage) {
            <div class="workflow">
              @if (needsDisposition) {
                <mat-form-field appearance="outline"><mat-label>Disposition</mat-label>
                  <mat-select [(ngModel)]="edit.disposition">
                    @for (d of dispositions; track d) { <mat-option [value]="d">{{ d }}</mat-option> }
                  </mat-select></mat-form-field>
                <mat-form-field appearance="outline" class="grow"><mat-label>Disposition note</mat-label>
                  <input matInput [(ngModel)]="edit.dispositionNote"></mat-form-field>
                <button mat-stroked-button color="primary" [disabled]="!edit.disposition || busy" (click)="saveDisposition()">
                  <mat-icon>gavel</mat-icon> Record disposition
                </button>
              }
              <span class="spacer"></span>
              @for (t of allowedTransitions; track t) {
                <button mat-raised-button
                        [color]="t === 'closed' ? 'primary' : (t === 'cancelled' ? 'warn' : undefined)"
                        [disabled]="busy || (t === 'closed' && !hasDisposition)"
                        [matTooltip]="t === 'closed' && !hasDisposition ? 'Record a disposition first' : ''"
                        (click)="transition(t)">
                  {{ transitionVerb(t) }}
                </button>
              }
              @if (allowedTransitions.length === 0) { <span class="meta">Terminal state — no further transitions.</span> }
            </div>
          }

          <div class="detail-grid">
            <!-- Timeline -->
            <div class="timeline-col">
              <h4>Timeline</h4>
              <div class="timeline">
                @for (e of events; track e.id) {
                  <div class="event">
                    <mat-icon class="ev-icon ev-{{e.type}}">{{ eventIcon(e.type) }}</mat-icon>
                    <div class="ev-body">
                      <div class="ev-line">
                        @switch (e.type) {
                          @case ('created') { Raised }
                          @case ('status_change') { {{ statusLabel(e.fromStatus || '') }} → <b>{{ statusLabel(e.toStatus || '') }}</b> }
                          @case ('disposition') { Disposition: <b>{{ e.note }}</b> }
                          @case ('assignment') { {{ e.note }} }
                          @case ('comment') { {{ e.note }} }
                        }
                      </div>
                      <div class="ev-meta">{{ e.actorName || 'system' }} · {{ e.createdAt | date:'MMM d, HH:mm' }}</div>
                    </div>
                  </div>
                }
                @if (events.length === 0) { <p class="empty">No activity yet.</p> }
              </div>
              @if (canCreate) {
                <div class="comment-row">
                  <mat-form-field appearance="outline" class="grow"><mat-label>Add a comment</mat-label>
                    <input matInput [(ngModel)]="newComment" (keyup.enter)="addComment()"></mat-form-field>
                  <button mat-icon-button color="primary" [disabled]="!newComment.trim() || busy" (click)="addComment()">
                    <mat-icon>send</mat-icon>
                  </button>
                </div>
              }
            </div>

            <!-- CAPA -->
            <div class="capa-col">
              <h4>Corrective / Preventive Actions
                @if (canManage) {
                  <button mat-button color="primary" (click)="showAddCapa = !showAddCapa"><mat-icon>add</mat-icon> Add</button>
                }
              </h4>
              @if (showAddCapa) {
                <div class="form-row">
                  <mat-form-field appearance="outline" class="grow"><mat-label>Title</mat-label>
                    <input matInput [(ngModel)]="newCapa.title"></mat-form-field>
                  <mat-form-field appearance="outline"><mat-label>Type</mat-label>
                    <mat-select [(ngModel)]="newCapa.type">
                      @for (t of capaTypes; track t) { <mat-option [value]="t">{{ t }}</mat-option> }
                    </mat-select></mat-form-field>
                  <mat-form-field appearance="outline"><mat-label>Due date</mat-label>
                    <input matInput type="date" [(ngModel)]="newCapa.dueDate"></mat-form-field>
                  <button mat-raised-button color="primary" [disabled]="!newCapa.title" (click)="saveCapa()">Add</button>
                </div>
              }
              @for (c of capas; track c.id) {
                <div class="capa-row" [class.overdue]="isOverdue(c)">
                  <div class="grow">
                    <div>{{ c.title }} <em>({{ c.type }})</em></div>
                    <div class="ev-meta">
                      <span class="status st-{{c.status}}">{{ c.status.replace('_',' ') }}</span>
                      @if (c.dueDate) { <span> · due {{ c.dueDate | date:'MMM d' }}</span> }
                      @if (c.verifiedAt) { <span> · verified {{ c.verifiedAt | date:'MMM d' }}</span> }
                    </div>
                  </div>
                  @if (canManage) {
                    @for (next of capaNext(c.status); track next) {
                      <button mat-stroked-button class="capa-btn" [disabled]="busy" (click)="moveCapa(c, next)">
                        {{ capaVerb(next) }}
                      </button>
                    }
                  }
                </div>
              }
              @if (capas.length === 0) { <p class="empty">No actions yet.</p> }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .page-shell { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .page-title { margin: 0; font-size: 22px; }
    .page-subtitle { margin: 2px 0 0; color: var(--clay-text-muted, #64748b); font-size: 13px; }
    .panel { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .panel h3 { margin: 0 0 4px; font-size: 15px; }
    .detail-head { display: flex; justify-content: space-between; align-items: flex-start; }
    .head-actions { display: flex; gap: 2px; }
    .evidence-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0 2px; }
    .evidence-row img { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; border: 1px solid var(--clay-border, #e2e8f0); }
    .attach-btn { height: 40px; }
    .meta-line { display: flex; gap: 8px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
    .meta { color: var(--clay-text-muted, #64748b); font-size: 12px; display: inline-flex; align-items: center; gap: 2px; }
    .mi { font-size: 14px; width: 14px; height: 14px; }
    .desc { color: var(--clay-text-secondary, #475569); font-size: 13px; margin: 8px 0 0; }
    .form-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .form-row mat-form-field { min-width: 150px; }
    .grow { flex: 1; }
    .full { width: 100%; }
    .spacer { flex: 1; }
    .panel-actions { display: flex; justify-content: flex-end; gap: 8px; }
    table.full { width: 100%; }
    .row-selected { background: var(--info-bg, #eff6ff); }
    .chip { padding: 2px 8px; border-radius: 10px; font-size: 12px; text-transform: capitalize; }
    .mark { font-family: 'Space Grotesk', monospace; font-weight: 600; }
    .sev-low { background: #e2e8f0; } .sev-medium { background: #fde68a; } .sev-high { background: #fdba74; } .sev-critical { background: #fca5a5; }
    .status { padding: 2px 10px; border-radius: 10px; font-size: 12px; font-weight: 600; text-transform: capitalize; background: #e2e8f0; }
    .st-open { background: var(--danger-bg, #fee2e2); color: var(--danger-text, #b91c1c); }
    .st-investigation { background: var(--warning-bg, #fef3c7); color: var(--warning-text, #92400e); }
    .st-disposition { background: var(--info-bg, #dbeafe); color: var(--info-text, #1d4ed8); }
    .st-closed, .st-verified { background: var(--success-bg, #dcfce7); color: var(--success-text, #166534); }
    .st-cancelled { background: #e2e8f0; color: #475569; }
    .st-in_progress { background: var(--info-bg, #dbeafe); color: var(--info-text, #1d4ed8); }
    .filters { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
    .chip-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .filter-chip { border: 1px solid var(--clay-border, #e2e8f0); background: var(--clay-surface, #fff); border-radius: 16px; padding: 5px 14px; font-size: 12.5px; cursor: pointer; }
    .filter-chip.active { background: var(--clay-primary, #2563eb); color: #fff; border-color: var(--clay-primary, #2563eb); }
    .sev-filter { width: 140px; }
    .search { width: 260px; }
    .workflow { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 14px 0 4px; padding: 12px; border: 1px dashed var(--clay-border, #e2e8f0); border-radius: 8px; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 14px; }
    @media (max-width: 900px) { .detail-grid { grid-template-columns: 1fr; } }
    h4 { margin: 4px 0 8px; font-size: 13.5px; display: flex; align-items: center; gap: 6px; }
    .timeline { max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .event { display: flex; gap: 10px; align-items: flex-start; }
    .ev-icon { font-size: 18px; width: 18px; height: 18px; margin-top: 2px; color: var(--clay-text-muted, #64748b); }
    .ev-created { color: var(--danger, #dc2626); }
    .ev-status_change { color: var(--info, #2563eb); }
    .ev-disposition { color: #7c3aed; }
    .ev-comment { color: var(--clay-text, #0f172a); }
    .ev-line { font-size: 13px; }
    .ev-meta { font-size: 11.5px; color: var(--clay-text-muted, #64748b); margin-top: 1px; }
    .comment-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
    .capa-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--clay-border, #eee); }
    .capa-row.overdue { background: var(--danger-bg, #fef2f2); }
    .capa-btn { font-size: 12px; line-height: 30px; padding: 0 10px; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; color: var(--clay-text-muted, #64748b); padding: 16px; }
  `],
})
export class NcrComponent implements OnInit, OnDestroy {
  readonly severities = SEVERITIES;
  readonly dispositions = DISPOSITIONS;
  readonly capaTypes = CAPA_TYPES;
  readonly statusFilters = [
    { value: 'open-any', label: 'Open (any)' },
    { value: '', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'investigation', label: 'Investigating' },
    { value: 'disposition', label: 'Disposition' },
    { value: 'closed', label: 'Closed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];
  columns = ['number', 'title', 'project', 'item', 'severity', 'status', 'actions'];

  loading = true;
  busy = false;
  ncrs: NcrRow[] = [];
  showAdd = false;
  newNcr: any = { title: '', description: '', severity: 'medium' };

  statusFilter = 'open-any';
  severityFilter = '';
  search = '';

  selected: NcrRow | null = null;
  allowedTransitions: string[] = [];
  edit: any = { disposition: null, dispositionNote: '' };
  events: NcrEventRow[] = [];
  evidenceUrls: string[] = [];
  newComment = '';
  capas: any[] = [];
  showAddCapa = false;
  newCapa: any = { title: '', type: 'corrective', dueDate: '' };

  canCreate = false;
  canManage = false;

  constructor(private api: NcrApiService, private snack: MatSnackBar, private permissions: PermissionsService) {}

  ngOnInit(): void {
    this.canCreate = this.permissions.can('ncr.create');
    this.canManage = this.permissions.can('ncr.manage');
    this.load();
  }

  ngOnDestroy(): void {
    this.clearEvidence();
  }

  statusLabel(s: string): string { return STATUS_LABELS[s] ?? s; }
  transitionVerb(t: string): string { return TRANSITION_VERBS[t] ?? (t === 'investigation' ? 'Reopen' : t); }
  eventIcon(t: string): string {
    return { created: 'report_problem', status_change: 'sync_alt', disposition: 'gavel', assignment: 'person_pin', comment: 'chat_bubble_outline' }[t] ?? 'circle';
  }
  capaNext(s: string): string[] { return CAPA_NEXT[s] ?? []; }
  capaVerb(s: string): string {
    return { in_progress: 'Start', verified: 'Verify', closed: 'Close', open: 'Reopen' }[s] ?? s;
  }
  isOverdue(c: any): boolean {
    return !!c.dueDate && c.status !== 'closed' && new Date(c.dueDate) < new Date();
  }

  /** A disposition either already recorded or picked in the form (rides along on close). */
  get hasDisposition(): boolean { return !!(this.selected?.disposition || this.edit.disposition); }
  get needsDisposition(): boolean {
    const st = this.selected?.status;
    return st === 'investigation' || st === 'disposition' || st === 'open';
  }

  setStatusFilter(v: string): void { this.statusFilter = v; this.load(); }

  load(): void {
    this.loading = true;
    const filters: any = {};
    if (this.statusFilter === 'open-any') filters.open = 'true';
    else if (this.statusFilter) filters.status = this.statusFilter;
    if (this.severityFilter) filters.severity = this.severityFilter;
    if (this.search.trim()) filters.q = this.search.trim();
    this.api.listNcr(filters).subscribe({
      next: (data: any) => { this.ncrs = Array.isArray(data) ? data : (data?.data || []); this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  saveNcr(): void {
    this.api.createNcr(this.newNcr).subscribe({
      next: (n) => {
        this.snack.open(`NCR ${n?.number ?? ''} raised`, 'OK', { duration: 2500 });
        this.showAdd = false; this.newNcr = { title: '', description: '', severity: 'medium' }; this.load();
      },
      error: (e) => this.snack.open(e?.error?.message || 'Failed to raise NCR', 'Dismiss', { duration: 4000 }),
    });
  }

  openDetail(n: NcrRow): void {
    this.selected = n;
    this.allowedTransitions = [];
    this.events = [];
    this.clearEvidence();
    this.edit = { disposition: n.disposition || null, dispositionNote: n.dispositionNote || '' };
    this.showAddCapa = false;
    this.refreshDetail(n.id);
    this.loadCapas();
  }

  closeDetail(): void {
    this.selected = null;
    this.clearEvidence();
  }

  private refreshDetail(id: string): void {
    this.api.getNcr(id).subscribe({
      next: (full) => {
        this.selected = full;
        this.allowedTransitions = full.allowedTransitions ?? [];
        this.edit = { disposition: full.disposition || null, dispositionNote: full.dispositionNote || '' };
        this.loadEvidence(full);
      },
      error: () => {},
    });
    this.api.listEvents(id).subscribe({ next: (ev) => (this.events = ev ?? []), error: () => (this.events = []) });
  }

  private loadEvidence(n: NcrRow): void {
    this.clearEvidence();
    const count = n.attachments?.length ?? 0;
    for (let i = 0; i < count; i++) {
      this.api.getEvidence(n.id, i).subscribe({
        next: (blob) => this.evidenceUrls.push(URL.createObjectURL(blob)),
        error: () => { /* evidence is best-effort */ },
      });
    }
  }

  private clearEvidence(): void {
    for (const url of this.evidenceUrls) URL.revokeObjectURL(url);
    this.evidenceUrls = [];
  }

  onPhotoPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.selected) return;
    this.busy = true;
    this.api.uploadEvidence(this.selected.id, file).subscribe({
      next: () => { this.busy = false; this.snack.open('Photo attached', 'OK', { duration: 2000 }); this.refreshDetail(this.selected!.id); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Upload failed', 'Dismiss', { duration: 4000 }); },
    });
  }

  /** 409 = someone else changed the NCR — reload so the user acts on fresh state. */
  private handleMutationError(e: any): void {
    if (e?.status === 409) {
      this.snack.open(e?.error?.message || 'This NCR changed elsewhere — reloaded it.', 'OK', { duration: 4500 });
      if (this.selected) { this.refreshDetail(this.selected.id); this.load(); }
      return;
    }
    this.snack.open(e?.error?.message || 'Update failed', 'Dismiss', { duration: 4500 });
  }

  /** Customer-facing printable nonconformance report (browser print → PDF). */
  printNcr(): void {
    const n = this.selected;
    if (!n) return;
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cap = (s: any) => esc(String(s ?? '').replace(/_/g, ' '));
    const rows = (label: string, value: string) =>
      value ? `<tr><th>${label}</th><td>${value}</td></tr>` : '';
    const timeline = this.events.map((e) => {
      const what = e.type === 'created' ? 'Raised'
        : e.type === 'status_change' ? `${cap(e.fromStatus)} → ${cap(e.toStatus)}`
        : e.type === 'disposition' ? `Disposition: ${esc(e.note)}`
        : esc(e.note);
      const when = e.createdAt ? new Date(e.createdAt).toLocaleString() : '';
      return `<tr><td>${when}</td><td>${cap(e.type)}</td><td>${what}</td><td>${esc(e.actorName ?? '')}</td></tr>`;
    }).join('');
    const capas = this.capas.map((c) =>
      `<tr><td>${esc(c.title)}</td><td>${cap(c.type)}</td><td>${cap(c.status)}</td><td>${c.dueDate ? new Date(c.dueDate).toLocaleDateString() : ''}</td></tr>`,
    ).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(n.number)}</title>
      <style>
        body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111; margin: 32px; }
        h1 { font-size: 20px; margin: 0 0 2px; } .sub { color: #555; font-size: 12px; margin-bottom: 18px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 18px; font-size: 12.5px; }
        th, td { border: 1px solid #ccc; padding: 6px 9px; text-align: left; vertical-align: top; }
        th { background: #f3f4f6; width: 160px; font-weight: 600; }
        h2 { font-size: 14px; margin: 18px 0 6px; }
        .tl th { width: auto; }
        @media print { body { margin: 12mm; } }
      </style></head><body>
      <h1>Nonconformance Report ${esc(n.number)}</h1>
      <div class="sub">Status: ${cap(n.status)} · Severity: ${cap(n.severity)} · Printed ${new Date().toLocaleString()}</div>
      <table>
        ${rows('Title', esc(n.title))}
        ${rows('Description', esc(n.description ?? ''))}
        ${rows('Project', esc(n.projectName ?? ''))}
        ${rows('Item', esc(n.itemMark ?? ''))}
        ${rows('Disposition', n.disposition ? `${cap(n.disposition)}${n.dispositionNote ? ' — ' + esc(n.dispositionNote) : ''}` : '')}
        ${rows('Raised', n.createdAt ? new Date(n.createdAt).toLocaleString() : '')}
        ${rows('Closed', n.closedAt ? new Date(n.closedAt).toLocaleString() : '')}
      </table>
      ${timeline ? `<h2>Timeline</h2><table class="tl"><tr><th>When</th><th>Action</th><th>Detail</th><th>By</th></tr>${timeline}</table>` : ''}
      ${capas ? `<h2>Corrective / Preventive Actions</h2><table class="tl"><tr><th>Title</th><th>Type</th><th>Status</th><th>Due</th></tr>${capas}</table>` : ''}
      <script>window.onload = () => window.print();</script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { this.snack.open('Pop-up blocked — allow pop-ups to print', 'OK', { duration: 4000 }); return; }
    w.document.write(html);
    w.document.close();
  }

  /** Record the disposition decision without changing status. */
  saveDisposition(): void {
    if (!this.selected) return;
    this.busy = true;
    this.api.updateNcr(this.selected.id, {
      disposition: this.edit.disposition,
      dispositionNote: this.edit.dispositionNote || undefined,
      expectedVersion: this.selected.version,
    }).subscribe({
      next: () => { this.busy = false; this.snack.open('Disposition recorded', 'OK', { duration: 2000 }); this.refreshDetail(this.selected!.id); this.load(); },
      error: (e) => { this.busy = false; this.handleMutationError(e); },
    });
  }

  /** Guided transition — server validates against the workflow state machine. */
  transition(to: string): void {
    if (!this.selected) return;
    this.busy = true;
    const body: any = { status: to, expectedVersion: this.selected.version };
    // Allow disposition to ride along when closing straight from the form.
    if (to === 'closed' && this.edit.disposition && this.edit.disposition !== this.selected.disposition) {
      body.disposition = this.edit.disposition;
      if (this.edit.dispositionNote) body.dispositionNote = this.edit.dispositionNote;
    }
    this.api.updateNcr(this.selected.id, body).subscribe({
      next: () => { this.busy = false; this.snack.open(`NCR ${this.statusLabel(to).toLowerCase()}`, 'OK', { duration: 2000 }); this.refreshDetail(this.selected!.id); this.load(); },
      error: (e) => { this.busy = false; this.handleMutationError(e); },
    });
  }

  addComment(): void {
    if (!this.selected || !this.newComment.trim()) return;
    this.busy = true;
    this.api.addComment(this.selected.id, this.newComment.trim()).subscribe({
      next: () => { this.busy = false; this.newComment = ''; this.refreshDetail(this.selected!.id); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Comment failed', 'Dismiss', { duration: 3000 }); },
    });
  }

  loadCapas(): void {
    if (!this.selected) return;
    this.api.listCapa(this.selected.id).subscribe({
      next: (data) => { this.capas = Array.isArray(data) ? data : (data?.data || []); },
      error: () => { this.capas = []; },
    });
  }

  saveCapa(): void {
    if (!this.selected) return;
    const body: any = { ncrId: this.selected.id, title: this.newCapa.title, type: this.newCapa.type };
    if (this.newCapa.dueDate) body.dueDate = this.newCapa.dueDate;
    this.api.createCapa(body).subscribe({
      next: () => { this.snack.open('Action added', 'OK', { duration: 2000 }); this.showAddCapa = false; this.newCapa = { title: '', type: 'corrective', dueDate: '' }; this.loadCapas(); },
      error: (e) => this.snack.open(e?.error?.message || 'Failed to add action', 'Dismiss', { duration: 4000 }),
    });
  }

  moveCapa(c: any, status: string): void {
    this.busy = true;
    this.api.updateCapa(c.id, { status }).subscribe({
      next: () => { this.busy = false; this.snack.open('Action updated', 'OK', { duration: 1500 }); this.loadCapas(); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Update failed', 'Dismiss', { duration: 4000 }); this.loadCapas(); },
    });
  }
}
