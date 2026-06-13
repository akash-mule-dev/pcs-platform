import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SupportDeskApiService } from './support-desk.service';
import { SupportMeta, TicketDetail, TicketSummary } from './support.service';

@Component({
  selector: 'app-support-desk',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatCheckboxModule],
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
          <mat-select [(ngModel)]="f.status" (selectionChange)="load()">
            <mat-option value="">All</mat-option>
            @for (s of meta?.statuses || []; track s.value) { <mat-option [value]="s.value">{{ s.label }}</mat-option> }
          </mat-select></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Priority</mat-label>
          <mat-select [(ngModel)]="f.priority" (selectionChange)="load()">
            <mat-option value="">All</mat-option>
            @for (p of meta?.priorities || []; track p.value) { <mat-option [value]="p.value">{{ p.label }}</mat-option> }
          </mat-select></mat-form-field>
        <mat-form-field appearance="outline" class="search"><mat-label>Search</mat-label>
          <input matInput [(ngModel)]="f.q" (keyup.enter)="load()" placeholder="number or subject">
        </mat-form-field>
        <button mat-stroked-button (click)="load()"><mat-icon>search</mat-icon> Apply</button>
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
            </div>
          }
          @if (!tickets.length && loaded) { <p class="empty">No tickets match.</p> }
        </div>

        <div class="panel detail">
          @if (selected) {
            <div class="d-head">
              <div>
                <h3>{{ selected.subject }}</h3>
                <div class="d-sub">{{ selected.number }} · {{ selected.organizationName || '—' }} · raised by {{ selected.raisedByName }} ({{ selected.raisedByEmail }})</div>
                @if (selected.contextUrl) { <div class="d-sub">From page: <code>{{ selected.contextUrl }}</code></div> }
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
              @if (selected.assignedToUserId) {
                <button mat-stroked-button (click)="assign(null)">Unassign ({{ selected.assignedToName }})</button>
              } @else {
                <button mat-stroked-button color="primary" (click)="assign('me')"><mat-icon>person_add</mat-icon> Assign to me</button>
              }
            </div>

            <div class="thread">
              <div class="msg customer">
                <div class="m-head"><strong>{{ selected.raisedByName }}</strong> · {{ selected.createdAt | date:'short' }}</div>
                <div class="m-body">{{ selected.description }}</div>
              </div>
              @for (m of selected.messages; track m.id) {
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
                  </div>
                }
              }
            </div>

            <div class="reply">
              <mat-form-field appearance="outline" class="full">
                <mat-label>{{ internal ? 'Internal note (not shown to customer)' : 'Reply to customer' }}</mat-label>
                <textarea matInput [(ngModel)]="replyBody" rows="3"></textarea>
              </mat-form-field>
              <div class="reply-actions">
                <mat-checkbox [(ngModel)]="internal">Internal note</mat-checkbox>
                <button mat-raised-button color="primary" [disabled]="!replyBody.trim() || busy" (click)="send()">
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
    .reply-actions { display: flex; justify-content: space-between; align-items: center; }
    .placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 340px; color: var(--clay-text-muted, #64748b); gap: 8px; }
    .placeholder mat-icon { font-size: 40px; width: 40px; height: 40px; } .empty { color: var(--clay-text-muted, #64748b); padding: 8px; }
    code { background: var(--clay-bg, #f1f5f9); padding: 1px 5px; border-radius: 4px; }
  `],
})
export class SupportDeskComponent implements OnInit {
  tickets: TicketSummary[] = [];
  selected: TicketDetail | null = null;
  meta: SupportMeta | null = null;
  stats: Record<string, number> = {};
  statKeys: string[] = [];
  f = { status: '', priority: '', q: '' };
  replyBody = '';
  internal = false;
  loaded = false;
  busy = false;

  constructor(private api: SupportDeskApiService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.api.meta().subscribe({ next: (m) => (this.meta = m), error: () => {} });
    this.loadStats();
    this.load();
  }

  label(kind: 'statuses' | 'priorities' | 'categories', value: string): string {
    return this.meta?.[kind]?.find((x) => x.value === value)?.label ?? value;
  }

  loadStats(): void {
    this.api.stats().subscribe({
      next: (s) => { this.stats = s ?? {}; this.statKeys = Object.keys(this.stats).filter((k) => k !== 'total'); },
      error: () => {},
    });
  }

  load(): void {
    this.api.list({ status: this.f.status || undefined, priority: this.f.priority || undefined, q: this.f.q || undefined }).subscribe({
      next: (rows) => { this.tickets = rows ?? []; this.loaded = true; },
      error: () => (this.loaded = true),
    });
  }

  open(t: TicketSummary): void {
    this.api.get(t.id).subscribe({ next: (d) => (this.selected = d), error: () => {} });
  }

  private apply(patch: { status?: string; priority?: string; assignedToUserId?: string | null }): void {
    if (!this.selected) return;
    this.busy = true;
    this.api.update(this.selected.id, patch).subscribe({
      next: (d) => { this.busy = false; this.selected = d; this.load(); this.loadStats(); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Update failed', 'Dismiss', { duration: 4000 }); },
    });
  }

  setStatus(status: string): void { this.apply({ status }); }
  setPriority(priority: string): void { this.apply({ priority }); }
  assign(who: 'me' | null): void { this.apply({ assignedToUserId: who }); }

  send(): void {
    if (!this.selected || !this.replyBody.trim()) return;
    this.busy = true;
    this.api.reply(this.selected.id, this.replyBody.trim(), this.internal).subscribe({
      next: (d) => { this.busy = false; this.selected = d; this.replyBody = ''; this.load(); this.loadStats(); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Reply failed', 'Dismiss', { duration: 4000 }); },
    });
  }
}
