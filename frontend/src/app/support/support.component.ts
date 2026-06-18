import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SupportApiService, SupportMeta, TicketDetail, TicketMessage, TicketSummary } from './support.service';
import { SupportTicketDialogComponent } from './support-ticket-dialog.component';
import { PermissionsService } from '../core/services/permissions.service';
import { RealtimeService } from '../core/services/realtime.service';

@Component({
  selector: 'app-support',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatDialogModule, MatTooltipModule],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Support</h1>
          <p class="page-subtitle">Raise a ticket and track our replies. We're notified the moment you post.</p>
        </div>
        @if (canCreate) {
          <button mat-raised-button color="primary" (click)="openNew()"><mat-icon>add</mat-icon> New ticket</button>
        }
      </div>

      <div class="grid">
        <div class="panel list">
          <mat-form-field appearance="outline" class="filter">
            <mat-label>Status</mat-label>
            <mat-select [(ngModel)]="statusFilter" (selectionChange)="load()">
              <mat-option value="">All</mat-option>
              @for (s of meta?.statuses || []; track s.value) { <mat-option [value]="s.value">{{ s.label }}</mat-option> }
            </mat-select>
          </mat-form-field>
          @for (t of tickets; track t.id) {
            <div class="row" [class.active]="selected?.id === t.id" (click)="open(t)">
              <div class="row-top">
                <span class="num">{{ t.number }}</span>
                <span class="status" [attr.data-s]="t.status">{{ label('statuses', t.status) }}</span>
              </div>
              <div class="subj">{{ t.subject }}</div>
              <div class="meta">{{ label('priorities', t.priority) }} · {{ t.lastMessageAt | date:'short' }}</div>
            </div>
          }
          @if (!tickets.length && loaded) { <p class="empty">No tickets yet.</p> }
        </div>

        <div class="panel detail">
          @if (selected) {
            <div class="d-head">
              <div>
                <h3>{{ selected.subject }}</h3>
                <div class="d-sub">{{ selected.number }} · {{ label('categories', selected.category) }} · {{ label('priorities', selected.priority) }}</div>
              </div>
              <span class="status" [attr.data-s]="selected.status">{{ label('statuses', selected.status) }}</span>
            </div>

            <div class="thread">
              <div class="msg customer">
                <div class="m-head"><strong>{{ selected.raisedByName || 'You' }}</strong> · {{ selected.createdAt | date:'short' }}</div>
                <div class="m-body">{{ selected.description }}</div>
              </div>
              @for (m of selected.messages; track m.id) {
                @if (m.authorKind === 'system') {
                  <div class="sys">{{ m.body }} · {{ m.createdAt | date:'short' }}</div>
                } @else {
                  <div class="msg" [class.support]="m.authorKind === 'support'">
                    <div class="m-head">
                      <strong>{{ m.authorName }}</strong>
                      <span class="tag" [class.tag-support]="m.authorKind === 'support'">{{ m.authorKind === 'support' ? 'Support' : 'Customer' }}</span>
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

            @if (selected.status !== 'closed') {
              <div class="reply">
                <mat-form-field appearance="outline" class="full">
                  <mat-label>Write a reply</mat-label>
                  <textarea matInput [(ngModel)]="replyBody" rows="3"></textarea>
                </mat-form-field>
                @if (selectedFile) {
                  <div class="file-chip"><mat-icon>attach_file</mat-icon> {{ selectedFile.name }}
                    <button class="x" (click)="clearFile()"><mat-icon>close</mat-icon></button>
                  </div>
                }
                <div class="reply-actions">
                  <div class="left">
                    <button mat-button (click)="close()" [disabled]="busy">Close ticket</button>
                    <button mat-icon-button matTooltip="Attach an image or PDF" (click)="fileInput.click()" [disabled]="busy"><mat-icon>attach_file</mat-icon></button>
                    <input #fileInput type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" (change)="onFile($event)">
                  </div>
                  <button mat-raised-button color="primary" [disabled]="(!replyBody.trim() && !selectedFile) || busy" (click)="send()">Send reply</button>
                </div>
              </div>
            } @else {
              <p class="closed-note">This ticket is closed. Replying will reopen it.
                <button mat-button color="primary" (click)="selected.status='open'">Reply anyway</button>
              </p>
            }
          } @else {
            <div class="placeholder"><mat-icon>forum</mat-icon><p>Select a ticket to view the conversation.</p></div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-shell { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    .page-title { margin: 0; font-size: 22px; } .page-subtitle { margin: 2px 0 0; color: var(--clay-text-muted, #64748b); font-size: 13px; }
    .grid { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
    .panel { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 12px; }
    .list { max-height: calc(100vh - 180px); overflow: auto; } .filter { width: 100%; }
    .row { border: 1px solid var(--clay-border, #e2e8f0); border-radius: 8px; padding: 10px; margin-bottom: 8px; cursor: pointer; }
    .row:hover { border-color: var(--clay-primary, #2563eb); } .row.active { border-color: var(--clay-primary, #2563eb); background: var(--clay-primary-soft, #eff6ff); }
    .row-top { display: flex; justify-content: space-between; align-items: center; }
    .num { font-size: 12px; color: var(--clay-text-muted, #64748b); } .subj { font-weight: 600; font-size: 14px; margin: 3px 0; }
    .meta { font-size: 12px; color: var(--clay-text-muted, #64748b); }
    .status { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #e2e8f0; color: #334155; white-space: nowrap; }
    .status[data-s="open"] { background: #dbeafe; color: #1d4ed8; }
    .status[data-s="in_progress"] { background: #fef9c3; color: #854d0e; }
    .status[data-s="pending"] { background: #ffedd5; color: #9a3412; }
    .status[data-s="resolved"] { background: #dcfce7; color: #15803d; }
    .status[data-s="closed"] { background: #e2e8f0; color: #475569; }
    .detail { min-height: 360px; display: flex; flex-direction: column; }
    .d-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 1px solid var(--clay-border, #e2e8f0); padding-bottom: 10px; }
    .d-head h3 { margin: 0; font-size: 17px; } .d-sub { font-size: 12px; color: var(--clay-text-muted, #64748b); margin-top: 2px; }
    .thread { flex: 1; overflow: auto; padding: 12px 0; display: flex; flex-direction: column; gap: 10px; }
    .msg { border: 1px solid var(--clay-border, #e2e8f0); border-radius: 8px; padding: 10px; }
    .msg.support { background: #f0f9ff; border-color: #bae6fd; }
    .m-head { font-size: 12px; color: var(--clay-text-muted, #64748b); margin-bottom: 4px; }
    .m-body { font-size: 14px; white-space: pre-wrap; }
    .tag { font-size: 10px; border: 1px solid var(--clay-border, #e2e8f0); border-radius: 999px; padding: 0 6px; margin-left: 4px; }
    .tag-support { background: #0ea5e9; color: #fff; border-color: #0ea5e9; }
    .sys { text-align: center; font-size: 12px; color: var(--clay-text-muted, #64748b); }
    .reply { border-top: 1px solid var(--clay-border, #e2e8f0); padding-top: 10px; } .full { width: 100%; }
    .reply-actions { display: flex; justify-content: space-between; align-items: center; } .reply-actions .left { display: flex; align-items: center; gap: 2px; }
    .file-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; background: var(--clay-primary-soft, #eff6ff); color: #1d4ed8; border-radius: 999px; padding: 3px 6px 3px 10px; margin-bottom: 8px; }
    .file-chip mat-icon { font-size: 16px; width: 16px; height: 16px; } .file-chip .x { border: none; background: transparent; cursor: pointer; display: inline-flex; color: inherit; padding: 0; }
    .attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .att { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; border: 1px solid var(--clay-border, #e2e8f0); background: #fff; border-radius: 6px; padding: 3px 8px; cursor: pointer; }
    .att:hover { border-color: var(--clay-primary, #2563eb); } .att mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .closed-note { color: var(--clay-text-muted, #64748b); font-size: 13px; }
    .placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 300px; color: var(--clay-text-muted, #64748b); gap: 8px; }
    .placeholder mat-icon { font-size: 40px; width: 40px; height: 40px; }
    .empty { color: var(--clay-text-muted, #64748b); padding: 8px; }
  `],
})
export class SupportComponent implements OnInit, OnDestroy {
  tickets: TicketSummary[] = [];
  selected: TicketDetail | null = null;
  meta: SupportMeta | null = null;
  statusFilter = '';
  replyBody = '';
  selectedFile: File | null = null;
  loaded = false;
  busy = false;
  canCreate = false;

  private subs: Subscription[] = [];

  constructor(
    private api: SupportApiService,
    private dialog: MatDialog,
    private snack: MatSnackBar,
    private permissions: PermissionsService,
    private realtime: RealtimeService,
  ) {}

  ngOnInit(): void {
    this.canCreate = this.permissions.can('support.create');
    this.api.meta().subscribe({ next: (m) => (this.meta = m), error: () => {} });
    this.load();

    // Live updates: the gateway derives this user's org room from the JWT, so we
    // just join (no client-supplied org). On any change to one of the company's
    // tickets, refresh the list and re-fetch the open thread if it's the one hit.
    this.realtime.joinRoom('join-support-org', '');
    this.subs.push(this.realtime.on<{ ticketId: string }>('support:changed').subscribe((e) => {
      this.load();
      if (this.selected && e?.ticketId === this.selected.id) this.refreshSelected();
    }));
  }

  ngOnDestroy(): void {
    this.realtime.leaveRoom('join-support-org', 'leave-support-org', '');
    this.subs.forEach((s) => s.unsubscribe());
  }

  counter(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }

  label(kind: 'statuses' | 'priorities' | 'categories', value: string): string {
    return this.meta?.[kind]?.find((x) => x.value === value)?.label ?? value;
  }

  load(): void {
    this.api.list({ status: this.statusFilter || undefined }).subscribe({
      next: (rows) => { this.tickets = rows ?? []; this.loaded = true; },
      error: () => (this.loaded = true),
    });
  }

  open(t: TicketSummary): void {
    this.selectedFile = null;
    this.api.get(t.id).subscribe({ next: (d) => (this.selected = d), error: () => {} });
  }

  private refreshSelected(): void {
    if (!this.selected) return;
    this.api.get(this.selected.id).subscribe({ next: (d) => (this.selected = d), error: () => {} });
  }

  openNew(): void {
    this.dialog.open(SupportTicketDialogComponent, { data: {} }).afterClosed().subscribe((created) => {
      if (created) { this.load(); this.open(created); }
    });
  }

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
    const done = (d: TicketDetail) => { this.busy = false; this.selected = d; this.replyBody = ''; this.selectedFile = null; this.load(); this.snack.open('Reply sent', 'OK', { duration: 3000, panelClass: 'success-snackbar' }); };
    const fail = (e: any) => { this.busy = false; this.snack.open(e?.error?.message || 'Reply failed', 'Dismiss', { duration: 4000 }); };
    if (this.selectedFile) {
      this.api.replyWithAttachment(this.selected.id, this.selectedFile, body).subscribe({ next: done, error: fail });
    } else {
      this.api.reply(this.selected.id, body).subscribe({ next: done, error: fail });
    }
  }

  close(): void {
    if (!this.selected) return;
    this.busy = true;
    this.api.close(this.selected.id).subscribe({
      next: (d) => { this.busy = false; this.selected = d; this.load(); this.snack.open('Ticket resolved', 'OK', { duration: 3000, panelClass: 'success-snackbar' }); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Failed', 'Dismiss', { duration: 4000 }); },
    });
  }
}
