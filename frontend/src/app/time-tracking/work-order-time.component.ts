import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { TimeTrackingService, WorkOrderTimeSummary, TimeStage, TimeEntryRow, LookupUser, LookupStation } from '../core/services/time-tracking.service';
import { PermissionsService } from '../core/services/permissions.service';
import { DurationPipe } from '../shared/pipes/duration.pipe';
import { TimeEntryDialogComponent, TimeEntryDialogData } from './time-entry-dialog.component';

/**
 * Reusable per-work-order time panel: labor/machine cost cards, the stage rollup
 * (logged vs earned target), the per-worker split, and the full editable entry
 * ledger with add / edit / delete. Shared by the time console and the order tab.
 */
@Component({
  selector: 'app-work-order-time',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, DurationPipe],
  template: `
    @if (loading) {
      <div class="center"><mat-spinner diameter="28"></mat-spinner></div>
    } @else if (error) {
      <p class="banner err"><mat-icon>error</mat-icon>{{ error }} <button class="link" (click)="reload()">Retry</button></p>
    } @else if (summary) {

      <div class="cards">
        <div class="card">
          <div class="c-label"><mat-icon>engineering</mat-icon>Labor</div>
          <div class="c-actual">{{ summary.totals.laborCost | currency:summary.currency }}</div>
          <div class="c-est">{{ summary.totals.laborHours | number:'1.0-1' }} h · {{ summary.totals.entries }} entr{{ summary.totals.entries === 1 ? 'y' : 'ies' }}</div>
        </div>
        @if (hasMachine) {
          <div class="card">
            <div class="c-label"><mat-icon>precision_manufacturing</mat-icon>Machine</div>
            <div class="c-actual">{{ summary.totals.machineCost | currency:summary.currency }}</div>
            <div class="c-est">{{ summary.totals.machineHours | number:'1.0-1' }} h attended</div>
          </div>
        }
        <div class="card">
          <div class="c-label"><mat-icon>groups</mat-icon>Workers</div>
          <div class="c-actual">{{ summary.workers.length }}</div>
          <div class="c-est">on this work order</div>
        </div>
        <div class="spacer"></div>
        @if (canManage) {
          <button class="btn primary" (click)="openAdd()"><mat-icon>add</mat-icon>Log time</button>
        }
      </div>

      <!-- Per-stage rollup -->
      <h4 class="sec"><mat-icon>conveyor_belt</mat-icon>By stage</h4>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Stage</th><th>Status</th><th class="num">Units</th><th class="num">Logged</th>
            <th class="num">Earned target</th><th class="num">Var</th><th class="num">Entries</th>
            <th class="num">Labor</th>@if (hasMachine) { <th class="num">Machine</th> }
          </tr></thead>
          <tbody>
            @for (s of summary.stages; track s.workOrderStageId) {
              <tr>
                <td class="mono">{{ s.sequence }}. {{ s.name }}</td>
                <td><span class="chip st-{{ s.status }}">{{ s.status.replace('_', ' ') }}</span></td>
                <td class="num">{{ s.qtyDone }}<span class="muted">/{{ s.qtyTotal ?? '—' }}</span></td>
                <td class="num">{{ s.loggedSeconds ? (s.loggedSeconds | duration) : '—' }}</td>
                <td class="num">{{ earnedTarget(s) === null ? '—' : (earnedTarget(s)! | duration) }}</td>
                <td class="num" [class.over]="variance(s) !== null && variance(s)! > 5" [class.under]="variance(s) !== null && variance(s)! < -5">
                  {{ variance(s) === null ? '—' : (variance(s)! > 0 ? '+' : '') + (variance(s)! | number:'1.0-0') + '%' }}
                </td>
                <td class="num">{{ s.entries || '—' }}</td>
                <td class="num">{{ s.laborCost | currency:summary.currency }}</td>
                @if (hasMachine) { <td class="num">{{ s.machineCost | currency:summary.currency }}</td> }
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Per-worker split -->
      @if (summary.workers.length) {
        <h4 class="sec"><mat-icon>badge</mat-icon>By worker</h4>
        <div class="workers">
          @for (w of summary.workers; track w.userId) {
            <div class="wchip">
              <span class="wname">{{ w.name }}</span>
              <span class="wmeta">{{ w.hours | number:'1.0-1' }} h · {{ w.cost | currency:summary.currency }}</span>
            </div>
          }
        </div>
      }

      <!-- Entry ledger -->
      <h4 class="sec"><mat-icon>receipt_long</mat-icon>Time entries ({{ summary.entries.length }})</h4>
      @if (summary.entries.length === 0) {
        <p class="muted pad">No time logged on this work order yet.@if (canManage) { Use <b>Log time</b> above to add a record.}</p>
      } @else {
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Worker</th><th>Stage</th><th>Station</th><th>Start</th><th class="num">Worked</th>
              <th>Type</th><th class="num">Rate</th><th>Notes</th>@if (canManage) { <th></th> }
            </tr></thead>
            <tbody>
              @for (e of summary.entries; track e.id) {
                <tr [class.active]="!e.endTime">
                  <td>{{ e.userName }}</td>
                  <td class="muted">{{ e.stageName }}</td>
                  <td class="muted">{{ e.stationName || '—' }}</td>
                  <td class="muted">{{ e.startTime | date:'MMM d, HH:mm' }}</td>
                  <td class="num">
                    @if (e.endTime) {
                      {{ netSeconds(e) | duration }}@if (e.breakSeconds > 0) { <span class="muted sm" [matTooltip]="'less ' + (e.breakSeconds/60 | number:'1.0-0') + ' min break'">*</span> }
                    } @else { <span class="live"><mat-icon>fiber_manual_record</mat-icon>active</span> }
                  </td>
                  <td>
                    @if (e.isRework) { <span class="tag rework">Rework</span> }
                    @else if (e.isSetup) { <span class="tag setup">Setup</span> }
                    @else { <span class="tag run">Run</span> }
                  </td>
                  <td class="num">{{ e.laborRate != null ? (e.laborRate | currency:summary.currency) + '/h' : 'default' }}</td>
                  <td class="muted notes" [matTooltip]="e.notes || ''">{{ e.notes || '—' }}</td>
                  @if (canManage) {
                    <td class="actions">
                      <button class="ic" matTooltip="Edit" (click)="openEdit(e)"><mat-icon>edit</mat-icon></button>
                      <button class="ic danger" matTooltip="Delete" (click)="remove(e)"><mat-icon>delete</mat-icon></button>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
  styles: [`
    .center { display: flex; justify-content: center; padding: 28px 0; }
    .banner { display: flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 10px 12px; font-size: 13px; margin: 0 0 12px; }
    .banner.err { background: var(--danger-bg); color: var(--danger-text); }
    .link { background: none; border: none; padding: 0 0 0 6px; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }

    .cards { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; align-items: stretch; }
    .card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 12px 16px; min-width: 150px; box-shadow: var(--clay-shadow-soft); }
    .c-label { display: flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 700; color: var(--clay-text-muted); text-transform: uppercase; letter-spacing: .03em; }
    .c-label mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .c-actual { font-size: 20px; font-weight: 700; color: var(--clay-text); margin: 3px 0 1px; }
    .c-est { font-size: 11.5px; color: var(--clay-text-muted); }
    .spacer { flex: 1 1 auto; }

    .sec { display: flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 700; color: var(--clay-text); margin: 18px 0 9px; }
    .sec mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); }
    .pad { padding: 2px 0 10px; font-size: 13px; }

    .table-wrap { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); overflow-x: auto; box-shadow: var(--clay-shadow-soft); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: var(--clay-text-muted); padding: 9px 12px; border-bottom: 1px solid var(--clay-border); white-space: nowrap; }
    td { padding: 8px 12px; border-bottom: 1px solid var(--clay-border); }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: var(--clay-bg-warm); }
    tr.active { background: var(--success-bg); }
    .num { text-align: right; white-space: nowrap; } th.num { text-align: right; }
    .mono { font-family: 'Space Grotesk', monospace; font-weight: 600; }
    .muted { color: var(--clay-text-muted); } .sm { font-size: 11px; }
    .notes { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .over { color: var(--danger-text); font-weight: 600; } .under { color: var(--success-text); font-weight: 600; }
    .live { display: inline-flex; align-items: center; gap: 3px; color: var(--success-text); font-weight: 600; }
    .live mat-icon { font-size: 11px; width: 11px; height: 11px; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }

    .chip { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: capitalize; white-space: nowrap; }
    .st-pending { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .st-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .st-completed { background: var(--success-bg); color: var(--success-text); }
    .st-skipped { background: var(--badge-draft-bg); color: var(--clay-text-muted); }
    .tag { padding: 1px 8px; border-radius: var(--clay-radius-xs); font-size: 11px; font-weight: 700; }
    .tag.run { background: var(--info-bg); color: var(--clay-primary); }
    .tag.setup { background: var(--warning-bg); color: var(--warning-text); }
    .tag.rework { background: var(--danger-bg); color: var(--danger-text); }

    .workers { display: flex; gap: 8px; flex-wrap: wrap; }
    .wchip { display: flex; flex-direction: column; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 7px 12px; }
    .wname { font-size: 13px; font-weight: 600; color: var(--clay-text); }
    .wmeta { font-size: 11.5px; color: var(--clay-text-muted); }

    .actions { white-space: nowrap; text-align: right; }
    .ic { background: none; border: none; cursor: pointer; color: var(--clay-text-muted); padding: 2px; border-radius: var(--clay-radius-xs); }
    .ic:hover { color: var(--clay-primary); background: var(--clay-bg-warm); }
    .ic.danger:hover { color: var(--danger-text); }
    .ic mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .btn { display: inline-flex; align-items: center; gap: 4px; border-radius: var(--clay-radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; border: 1px solid var(--clay-border); align-self: center; }
    .btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .btn.primary { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
  `],
})
export class WorkOrderTimeComponent implements OnChanges {
  @Input() workOrderId!: string;
  @Output() changed = new EventEmitter<void>();

  private svc = inject(TimeTrackingService);
  private perms = inject(PermissionsService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  summary: WorkOrderTimeSummary | null = null;
  loading = false;
  error: string | null = null;
  private users: LookupUser[] = [];
  private stations: LookupStation[] = [];

  get canManage(): boolean { return this.perms.can('time-tracking.manage'); }
  get hasMachine(): boolean { return !!this.summary && (this.summary.totals.machineCost > 0 || this.summary.stages.some((s) => s.machineCost > 0)); }

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['workOrderId'] && this.workOrderId) this.reload();
  }

  reload(): void {
    if (!this.workOrderId) return;
    this.loading = true;
    this.error = null;
    this.svc.workOrderSummary(this.workOrderId).subscribe({
      next: (s) => { this.summary = s; this.loading = false; },
      error: (e) => { this.loading = false; this.error = e?.error?.message || 'Could not load time for this work order.'; },
    });
  }

  netSeconds(e: TimeEntryRow): number { return Math.max(0, (e.durationSeconds ?? 0) - (e.breakSeconds ?? 0)); }

  /** Earned target = per-unit stage target × units done (the fair benchmark for logged time). */
  earnedTarget(s: TimeStage): number | null {
    if (!s.targetTimeSeconds || !s.qtyDone) return null;
    return s.targetTimeSeconds * s.qtyDone;
  }
  variance(s: TimeStage): number | null {
    const t = this.earnedTarget(s);
    if (!t || !s.loggedSeconds) return null;
    return ((s.loggedSeconds - t) / t) * 100;
  }

  openAdd(): void { this.ensureLookups(() => this.openDialog('add')); }
  openEdit(e: TimeEntryRow): void { this.ensureLookups(() => this.openDialog('edit', e)); }

  private openDialog(mode: 'add' | 'edit', entry?: TimeEntryRow): void {
    if (!this.summary) return;
    const data: TimeEntryDialogData = {
      mode,
      workOrderId: this.workOrderId,
      workOrderLabel: `${this.summary.mark} · ${this.summary.orderNumber}`,
      stages: this.summary.stages.map((s) => ({ workOrderStageId: s.workOrderStageId, name: s.name, sequence: s.sequence })),
      users: this.users,
      stations: this.stations,
      entry,
    };
    this.dialog.open(TimeEntryDialogComponent, { data, width: '640px', maxWidth: '95vw' })
      .afterClosed().subscribe((r) => {
        if (r === 'saved') {
          this.snack.open(mode === 'add' ? 'Time logged' : 'Entry updated', 'OK', { duration: 2500 });
          this.reload();
          this.changed.emit();
        }
      });
  }

  remove(e: TimeEntryRow): void {
    if (!confirm(`Delete this ${this.netSeconds(e) ? (Math.round(this.netSeconds(e) / 60)) + ' min ' : ''}entry for ${e.userName}?`)) return;
    this.svc.remove(e.id).subscribe({
      next: () => { this.snack.open('Entry deleted', 'OK', { duration: 2500 }); this.reload(); this.changed.emit(); },
      error: (err) => { this.snack.open(err?.error?.message || 'Could not delete entry', 'Dismiss', { duration: 4000 }); },
    });
  }

  /** Lazily load users + stations once, for the add/edit dialog. */
  private ensureLookups(then: () => void): void {
    if (this.users.length || this.stations.length) { then(); return; }
    forkJoin({ users: this.svc.listUsers(), stations: this.svc.listStations() }).subscribe({
      next: ({ users, stations }) => { this.users = users; this.stations = stations; then(); },
      error: () => { then(); },
    });
  }
}
