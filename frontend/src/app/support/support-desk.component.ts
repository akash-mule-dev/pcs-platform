import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SupportDeskApiService } from './support-desk.service';
import { SupportAgent, SupportMeta, TicketDetail, TicketMessage, TicketSummary } from './support.service';
import { RealtimeService } from '../core/services/realtime.service';

@Component({
  selector: 'app-support-desk',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatCheckboxModule, MatTooltipModule],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Support Desk</h1>
          <p class="page-subtitle">Every tenant's tickets in one queue. Reply, assign, and move them through their lifecycle.</p>
        </div>
        <div class="stats">
          @for (s of statKeys; track s) { <span class="stat"><b>{{ stats[s] }}</b> {{ s }}</span> }
        </div>
      </div>

      <div class="filters">
        <mat-form-field appearance="outline"><mat-label>Status</mat-label>
          <mat-select [(ngModel)]="f.status" (selectionChange)="search()">
            <mat-option value="">All</mat-option>
            @for (s of meta?.statuses || []; track s.value) { <mat-option [value]="s.value">{{ s.label }}</mat-option> }
          </mat-select></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Priority</mat-label>
          <mat-select [(ngModel)]="f.priority" (selectionChange)="search()">
            <mat-option value="">All</mat-option>
            @for (p of meta?.priorities || []; track p.value) { <mat-option [value]="p.value">{{ p.label }}</mat-option> }
          </mat-select></mat-form-field>
        <mat-form-field appearance="outline" class="search"><mat-label>Search</mat-label>
          <input matInput [(ngModel)]="f.q" (keyup.enter)="search()" placeholder="number or subject">
        </mat-form-field>
        <button mat-stroked-button (click)="search()"><mat-icon>search</mat-icon> Apply</button>
      </div>

      <div class="grid">
        <div class="panel list">
          @for (t of tickets; track t.id) {
            <div class="row" [class.active]="selected?.id === t.id" (click)="open(t)">
              <div class="row-top">
                <span class="num">{{ t.number }}</span>
                <span class="status" [attr.data-s]="t.status">{{ label('statuses', t.status) }}</span>
              </div>
              <div class="subj">{{ t.subject }}</div>
              <div class="meta">
                <span class="prio" [attr.data-p]="t.priority">{{ label('priorities', t.priority) }}</span>
                · {{ t.organizationName || '—' }} · {{ t.assignedToName || 'unassigned' }}
              </div>
              <div class="sla">
                @if (t.awaitingFirstResponse) { <span class="badge wait">Awaiting first reply</span> }
                <span class="age" matTooltip="Opened {{ t.createdAt | date:'medium' }}">opened {{ ago(t.createdAt) }} ago</span>
              </div>
            </div>
          }
          @if (!tickets.length && loaded) { <p class="empty">No tickets match.</p> }
          @if (total > limit || offset > 0) {
            <div class="pager">
              <button mat-icon-button (click)="prevPage()" [disabled]="offset === 0" matTooltip="Previous"><mat-icon>chevron_left</mat-icon></button>
              <span class="range">{{ total ? offset + 1 : 0 }}–{{ pageEnd }} of {{ total }}</span>
              <button mat-icon-button (click)="nextPage()" [disabled]="pageEnd >= total" matTooltip="Next"><mat-icon>chevron_right</mat-icon></button>
            </div>
          }
        </div>

        <div class="panel detail">
          @if (selected) {
            <div class="d-head">
              <div>
                <h3>{{ selected.subject }}</h3>
                <div class="d-sub">{{ selected.number }} · {{ selected.organizationName || '—' }} · raised by {{ selected.raisedByName }} ({{ selected.raisedByEmail }})</div>
                @if (selected.contextUrl) { <div class="d-sub">From page: <code>{{ selected.contextUrl }}</code></div> }
                <div class="d-sub sla-line">
                  Opened {{ ago(selected.createdAt) }} ago ·
                  @if (selected.firstResponseAt) { first reply {{ ago(selected.firstResponseAt) }} after open }
                  @else if (selected.awaitingFirstResponse) { <span class="badge wait">Awaiting first reply</span> }
                  @else { no reply yet }
                </div>
              </div>
            </div>

            <div class="controls">
              <mat-form-field appearance="outline"><mat-label>Status</mat-label>
                <mat-select [ngModel]="selected.status" (selectionChange)="setStatus($event.value)">
                  @for (s of meta?.statuses || []; track s.value) { <mat-option [value]="s.value">{{ s.label }}</mat-option> }
                </mat-select></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Priority</mat-label>
                <mat-select [ngModel]="selected.priority" (selectionChange)="setPriority($event.value)">
                  @for (p of meta?.priorities || []; track p.value) { <mat-option [value]="p.value">{{ p.label }}</mat-option> }
                </mat-select></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>Assignee</mat-label>
                <mat-select [ngModel]="selected.assignedToUserId || ''" (selectionChange)="assign($event.value)">
                  <mat-option value="">Unassigned</mat-option>
                  @for (a of agents; track a.id) { <mat-option [value]="a.id">{{ a.name }}</mat-option> }
                </mat-select></mat-form-field>
              <button mat-stroked-button (click)="assign('me')"><mat-icon>person_add</mat-icon> Me</button>
            </div>

            <div class="thread-bar">
              <mat-checkbox [(ngModel)]="showInternal">Show internal notes</mat-checkbox>
            </div>
            <div class="thread">
              <div class="msg customer">
                <div class="m-head"><strong>{{ selected.raisedByName }}</strong> · {{ selected.createdAt | date:'short' }}</div>
                <div class="m-body">{{ selected.description }}</div>
              </div>
              @for (m of visibleMessages(); track m.id) {
                @if (m.authorKind === 'system') {
                  <div class="sys">{{ m.body }} · {{ m.createdAt | date:'short' }}</div>
                } @else {
                  <div class="msg" [class.support]="m.authorKind === 'support'" [class.internal]="m.internal">
                    <div class="m-head">
                      <strong>{{ m.authorName }}</strong>
                      <span class="tag" [class.tag-support]="m.authorKind === 'support'">{{ m.authorKind === 'support' ? 'Support' : 'Customer' }}</span>
                      @if (m.internal) { <span class="tag tag-internal">Internal</span> }
                      · {{ m.createdAt | date:'short' }}
                    </div>
                    <div class="m-body">{{ m.body }}</div>
                    @if (m.attachmentCount) {
                      <div class="attachments">
                        @for (i of counter(m.attachmentCount); track i) {
                          <button class="att" (click)="openAttachment(m, i)"><mat-icon>attachment</mat-icon> Attachment {{ i + 1 }}</button>
                        }
                      </div>
                    }
                  </div>
                }
              }
            </div>

            <div class="reply">
              <mat-form-field appearance="outline" class="full">
                <mat-label>{{ internal ? 'Internal note (not shown to customer)' : 'Reply to customer' }}</mat-label>
                <textarea matInput [(ngModel)]="replyBody" rows="3"></textarea>
              </mat-form-field>
              @if (selectedFile) {
                <div class="file-chip"><mat-icon>attach_file</mat-icon> {{ selectedFile.name }}
                  <button class="x" (click)="clearFile()"><mat-icon>close</mat-icon></button>
                </div>
              }
              <div class="reply-actions">
                <div class="left">
                  <mat-checkbox [(ngModel)]="internal">Internal note</mat-checkbox>
                  <button mat-icon-button matTooltip="Attach an image or PDF" (click)="fileInput.click()" [disabled]="busy"><mat-icon>attach_file</mat-icon></button>
                  <input #fileInput type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" (change)="onFile($event)">
                </div>
                <button mat-raised-button color="primary" [disabled]="(!replyBody.trim() && !selectedFile) || busy" (click)="send()">
                  {{ internal ? 'Add note' : 'Send reply' }}
                </button>
              </div>
            </div>
          } @else {
            <div class="placeholder"><mat-icon>support_agent</mat-icon><p>Select a ticket to triage.</p></div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-shell { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; gap: 16px; flex-wrap: wrap; }
    .page-title { margin: 0; font-size: 22px; } .page-subtitle { margin: 2px 0 0; color: var(--clay-text-muted, #64748b); font-size: 13px; }
    .stats { display: flex; gap: 14px; flex-wrap: wrap; } .stat { font-size: 13px; color: var(--clay-text-muted, #64748b); } .stat b { color: var(--clay-text, #0f172a); font-size: 15px; }
    .filters { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; } .search { min-width: 220px; }
    .grid { display: grid; grid-template-columns: 340px 1fr; gap: 16px; align-items: start; }
    @media (max-width: 1000px) { .grid { grid-template-columns: 1fr; } }
    .panel { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 12px; }
    .list { max-height: calc(100vh - 240px); overflow: auto; }
    .row { border: 1px solid var(--clay-border, #e2e8f0); border-radius: 8px; padding: 10px; margin-bottom: 8px; cursor: pointer; }
    .row:hover { border-color: var(--clay-primary, #2563eb); } .row.active { border-color: var(--clay-primary, #2563eb); background: var(--clay-primary-soft, #eff6ff); }
    .row-top { display: flex; justify-content: space-between; align-items: center; }
    .num { font-size: 12px; color: var(--clay-text-muted, #64748b); } .subj { font-weight: 600; font-size: 14px; margin: 3px 0; }
    .meta { font-size: 12px; color: var(--clay-text-muted, #64748b); }
    .status { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #e2e8f0; color: #334155; white-space: nowrap; }
    .status[data-s="open"] { background: #dbeafe; color: #1d4ed8; } .status[data-s="in_progress"] { background: #fef9c3; color: #854d0e; }
    .status[data-s="pending"] { background: #ffedd5; color: #9a3412; } .status[data-s="resolved"] { background: #dcfce7; color: #15803d; }
    .status[data-s="closed"] { background: #e2e8f0; color: #475569; }
    .prio[data-p="urgent"] { color: #dc2626; font-weight: 600; } .prio[data-p="high"] { color: #ea580c; font-weight: 600; }
    .sla { display: flex; align-items: center; gap: 8px; margin-top: 5px; flex-wrap: wrap; }
    .age { font-size: 11px; color: var(--clay-text-muted, #94a3b8); }
    .badge { font-size: 10px; padding: 1px 7px; border-radius: 999px; font-weight: 600; }
    .badge.wait { background: #fee2e2; color: #b91c1c; }
    .pager { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 6px 0 2px; border-top: 1px solid var(--clay-border, #e2e8f0); margin-top: 6px; }
    .pager .range { font-size: 12px; color: var(--clay-text-muted, #64748b); }
    .sla-line { margin-top: 4px; } .sla-line .badge.wait { display: inline-block; }
    .thread-bar { display: flex; justify-content: flex-end; padding: 6px 0 0; font-size: 12px; }
    .detail { min-height: 420px; display: flex; flex-direction: column; }
    .d-head h3 { margin: 0; font-size: 17px; } .d-sub { font-size: 12px; color: var(--clay-text-muted, #64748b); margin-top: 2px; }
    .controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 10px 0; padding-bottom: 10px; border-bottom: 1px solid var(--clay-border, #e2e8f0); }
    .controls mat-form-field { width: 170px; }
    .thread { flex: 1; overflow: auto; padding: 8px 0; display: flex; flex-direction: column; gap: 10px; }
    .msg { border: 1px solid var(--clay-border, #e2e8f0); border-radius: 8px; padding: 10px; }
    .msg.support { background: #f0f9ff; border-color: #bae6fd; } .msg.internal { background: #fffbeb; border-color: #fde68a; }
    .m-head { font-size: 12px; color: var(--clay-text-muted, #64748b); margin-bottom: 4px; } .m-body { font-size: 14px; white-space: pre-wrap; }
    .tag { font-size: 10px; border: 1px solid var(--clay-border, #e2e8f0); border-radius: 999px; padding: 0 6px; margin-left: 4px; }
    .tag-support { background: #0ea5e9; color: #fff; border-color: #0ea5e9; } .tag-internal { background: #f59e0b; color: #fff; border-color: #f59e0b; }
    .sys { text-align: center; font-size: 12px; color: var(--clay-text-muted, #64748b); }
    .reply { border-top: 1px solid var(--clay-border, #e2e8f0); padding-top: 10px; } .full { width: 100%; }
    .reply-actions { display: flex; justify-content: space-between; align-items: center; } .reply-actions .left { display: flex; align-items: center; gap: 8px; }
    .file-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; background: #eff6ff; color: #1d4ed8; border-radius: 999px; padding: 3px 6px 3px 10px; margin-bottom: 8px; }
    .file-chip mat-icon { font-size: 16px; width: 16px; height: 16px; } .file-chip .x { border: none; background: transparent; cursor: pointer; display: inline-flex; color: inherit; padding: 0; }
    .attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .att { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; border: 1px solid var(--clay-border, #e2e8f0); background: #fff; border-radius: 6px; padding: 3px 8px; cursor: pointer; }
    .att:hover { border-color: var(--clay-primary, #2563eb); } .att mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 340px; color: var(--clay-text-muted, #64748b); gap: 8px; }
    .placeholder mat-icon { font-size: 40px; width: 40px; height: 40px; } .empty { color: var(--clay-text-muted, #64748b); padding: 8px; }
    code { background: var(--clay-bg, #f1f5f9); padding: 1px 5px; border-radius: 4px; }
  `],
})
export class SupportDeskComponent implements OnInit, OnDestroy {
  tickets: TicketSummary[] = [];
  selected: TicketDetail | null = null;
  meta: SupportMeta | null = null;
  agents: SupportAgent[] = [];
  stats: Record<string, number> = {};
  statKeys: string[] = [];
  f = { status: '', priority: '', q: '' };
  replyBody = '';
  internal = false;
  showInternal = true;
  selectedFile: File | null = null;
  loaded = false;
  busy = false;

  // Pagination (cross-tenant queue can be large).
  offset = 0;
  limit = 25;
  total = 0;

  private subs: Subscription[] = [];

  constructor(private api: SupportDeskApiService, private snack: MatSnackBar, private realtime: RealtimeService) {}

  ngOnInit(): void {
    this.api.meta().subscribe({ next: (m) => (this.meta = m), error: () => {} });
    this.api.agents().subscribe({ next: (a) => (this.agents = a ?? []), error: () => {} });
    this.loadStats();
    this.load();

    // Live desk queue: the gateway only lets platform operators join this room.
    // On any ticket change, refresh the list + stats and re-fetch the open thread
    // if it's the one that changed (customer replied, status moved).
    this.realtime.joinRoom('join-support-desk', '');
    this.subs.push(this.realtime.on<{ ticketId: string }>('support:changed').subscribe((e) => {
      this.load();
      this.loadStats();
      if (this.selected && e?.ticketId === this.selected.id) this.refreshSelected();
    }));
  }

  ngOnDestroy(): void {
    this.realtime.leaveRoom('join-support-desk', 'leave-support-desk', '');
    this.subs.forEach((s) => s.unsubscribe());
  }

  counter(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }

  label(kind: 'statuses' | 'priorities' | 'categories', value: string): string {
    return this.meta?.[kind]?.find((x) => x.value === value)?.label ?? value;
  }

  loadStats(): void {
    this.api.stats().subscribe({
      next: (s) => { this.stats = s ?? {}; this.statKeys = Object.keys(this.stats).filter((k) => k !== 'total'); },
      error: () => {},
    });
  }

  /** Re-run from page 0 (filter changed). */
  search(): void { this.offset = 0; this.load(); }

  load(): void {
    this.api.list({ status: this.f.status || undefined, priority: this.f.priority || undefined, q: this.f.q || undefined, limit: this.limit, offset: this.offset }).subscribe({
      next: (res) => { this.tickets = res?.items ?? []; this.total = res?.total ?? 0; this.loaded = true; },
      error: () => (this.loaded = true),
    });
  }

  prevPage(): void { if (this.offset > 0) { this.offset = Math.max(0, this.offset - this.limit); this.load(); } }
  nextPage(): void { if (this.offset + this.limit < this.total) { this.offset += this.limit; this.load(); } }
  get pageEnd(): number { return Math.min(this.offset + this.limit, this.total); }

  /** Compact relative age, e.g. "3h", "2d". */
  ago(iso: string | null | undefined): string {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    const m = s / 60; if (m < 60) return `${Math.floor(m)}m`;
    const h = m / 60; if (h < 24) return `${Math.floor(h)}h`;
    return `${Math.floor(h / 24)}d`;
  }

  /** Thread messages honoring the internal-notes toggle. */
  visibleMessages(): TicketMessage[] {
    const msgs = this.selected?.messages ?? [];
    return this.showInternal ? msgs : msgs.filter((m) => !m.internal);
  }

  open(t: TicketSummary): void {
    this.selectedFile = null;
    this.api.get(t.id).subscribe({ next: (d) => (this.selected = d), error: () => {} });
  }

  private refreshSelected(): void {
    if (!this.selected) return;
    this.api.get(this.selected.id).subscribe({ next: (d) => (this.selected = d), error: () => {} });
  }

  private apply(patch: { status?: string; priority?: string; assignedToUserId?: string | null }): void {
    if (!this.selected) return;
    this.busy = true;
    this.api.update(this.selected.id, { ...patch, expectedVersion: this.selected.version }).subscribe({
      next: (d) => { this.busy = false; this.selected = d; this.load(); this.loadStats(); },
      error: (e) => {
        this.busy = false;
        if (e?.status === 409) { this.snack.open('This ticket changed elsewhere — reloaded.', 'OK', { duration: 4000 }); this.refreshSelected(); this.load(); }
        else this.snack.open(e?.error?.message || 'Update failed', 'Dismiss', { duration: 4000 });
      },
    });
  }

  setStatus(status: string): void { this.apply({ status }); }
  setPriority(priority: string): void { this.apply({ priority }); }
  assign(who: string | null): void { this.apply({ assignedToUserId: who || null }); }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    input.value = '';
  }
  clearFile(): void { this.selectedFile = null; }

  openAttachment(m: TicketMessage, index: number): void {
    if (!this.selected) return;
    this.api.attachment(this.selected.id, m.id, index).subscribe({
      next: (blob) => window.open(URL.createObjectURL(blob), '_blank'),
      error: () => this.snack.open('Could not open attachment', 'Dismiss', { duration: 3000 }),
    });
  }

  send(): void {
    if (!this.selected || (!this.replyBody.trim() && !this.selectedFile)) return;
    this.busy = true;
    const body = this.replyBody.trim();
    const done = (d: TicketDetail) => { this.busy = false; this.selected = d; this.replyBody = ''; this.selectedFile = null; this.load(); this.loadStats(); };
    const fail = (e: any) => { this.busy = false; this.snack.open(e?.error?.message || 'Reply failed', 'Dismiss', { duration: 4000 }); };
    if (this.selectedFile) {
      this.api.replyWithAttachment(this.selected.id, this.selectedFile, body, this.internal).subscribe({ next: done, error: fail });
    } else {
      this.api.reply(this.selected.id, body, this.internal).subscribe({ next: done, error: fail });
    }
  }
}
