import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { interval, Subscription } from 'rxjs';
import { TimeTrackingService, FloorStatus, FloorSession, FloorStation, LookupWorkOrder, LookupStation } from '../../core/services/time-tracking.service';
import { AuthService } from '../../core/services/auth.service';
import { PermissionsService } from '../../core/services/permissions.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { WorkOrderTimeComponent } from '../work-order-time.component';

/**
 * Time-tracking console. Two views:
 *   • Floor — Live: real-time shop-floor status (who is working where, station
 *     occupancy, KPIs) with quick clock-in / clock-out for the current operator.
 *   • By work order: pick a work order → full per-stage / per-worker time + cost
 *     breakdown with add / edit / delete (the costing-facing view).
 */
@Component({
  selector: 'app-time-tracking-live',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, DurationPipe, WorkOrderTimeComponent],
  template: `
    <div class="page-header">
      <h2>Time Tracking</h2>
      <a class="btn ghost" routerLink="/time-tracking/history"><mat-icon>history</mat-icon>History</a>
    </div>

    <div class="tabs">
      <button class="tab" [class.active]="view === 'floor'" (click)="view = 'floor'"><mat-icon>precision_manufacturing</mat-icon>Floor — Live</button>
      <button class="tab" [class.active]="view === 'workorder'" (click)="view = 'workorder'"><mat-icon>receipt_long</mat-icon>By work order</button>
    </div>

    <!-- ───────────── FLOOR ───────────── -->
    @if (view === 'floor') {
      @if (floor) {
        <div class="kpis">
          <div class="kpi"><span class="k-val">{{ floor.kpis.activeOperators }}</span><span class="k-lbl">Operators active</span></div>
          <div class="kpi"><span class="k-val">{{ floor.kpis.activeWorkOrders }}</span><span class="k-lbl">Work orders running</span></div>
          <div class="kpi"><span class="k-val">{{ floor.kpis.busyStations }}<span class="k-sub">/{{ floor.kpis.stations }}</span></span><span class="k-lbl">Stations in use</span></div>
          <div class="kpi"><span class="k-val">{{ floor.kpis.activeSessions }}</span><span class="k-lbl">Open sessions</span></div>
          <div class="spacer"></div>
          @if (canTrack) {
            <button class="btn primary" (click)="toggleClockIn()"><mat-icon>play_circle</mat-icon>{{ myActive ? 'I am clocked in' : 'Clock in' }}</button>
          }
        </div>

        @if (showClockIn && canTrack) {
          <div class="clockin">
            <div class="ci-row">
              <label class="fld"><span>Work order</span>
                <select [(ngModel)]="ciWorkOrder" (ngModelChange)="onCiWorkOrder()">
                  <option value="" disabled>Select work order</option>
                  @for (wo of workOrders; track wo.id) { <option [value]="wo.id">{{ wo.orderNumber }}{{ wo.mark ? ' · ' + wo.mark : '' }}</option> }
                </select>
              </label>
              <label class="fld"><span>Stage</span>
                <select [(ngModel)]="ciStage" [disabled]="!ciStages.length">
                  <option value="" disabled>Select stage</option>
                  @for (s of ciStages; track s.id) { <option [value]="s.id">{{ s.stage?.name }}</option> }
                </select>
              </label>
              <label class="fld"><span>Station</span>
                <select [(ngModel)]="ciStation">
                  <option [value]="''">None</option>
                  @for (st of stations; track st.id) { <option [value]="st.id">{{ st.name }}</option> }
                </select>
              </label>
              <label class="chk"><input type="checkbox" [(ngModel)]="ciSetup"> Setup</label>
              <button class="btn primary sm" [disabled]="!ciStage || busy" (click)="clockIn()">Start</button>
            </div>
          </div>
        }

        <!-- Active operators -->
        <h3 class="sec"><mat-icon>person_pin_circle</mat-icon>On the floor now</h3>
        @if (floor.sessions.length === 0) {
          <div class="empty"><mat-icon>nightlight</mat-icon><p>No one is clocked in right now.</p></div>
        } @else {
          <div class="table-wrap">
            <table>
              <thead><tr><th>Operator</th><th>Work order</th><th>Stage</th><th>Station</th><th>Type</th><th class="num">Elapsed</th><th></th></tr></thead>
              <tbody>
                @for (s of floor.sessions; track s.id) {
                  <tr>
                    <td class="strong">{{ s.userName }}</td>
                    <td>@if (s.workOrderId) { <a [routerLink]="[]" (click)="openWorkOrder(s.workOrderId)">{{ s.orderNumber }}</a> } @else { — } <span class="muted">{{ s.mark ? '· ' + s.mark : '' }}</span></td>
                    <td class="muted">{{ s.stageName || '—' }}</td>
                    <td class="muted">{{ s.stationName || '—' }}<span class="muted sm">{{ s.lineName ? ' · ' + s.lineName : '' }}</span></td>
                    <td>@if (s.isRework) { <span class="tag rework">Rework</span> } @else if (s.isSetup) { <span class="tag setup">Setup</span> } @else { <span class="tag run">Run</span> }</td>
                    <td class="num live">{{ elapsed(s.startTime) | duration }}</td>
                    <td class="num">@if (s.userId === myUserId) { <button class="btn warn xs" [disabled]="busy" (click)="clockOut(s)">Clock out</button> }</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <!-- Station occupancy -->
        @if (floor.stations.length) {
          <h3 class="sec"><mat-icon>grid_view</mat-icon>Stations</h3>
          <div class="stations">
            @for (st of floor.stations; track st.id) {
              <div class="station" [class.busy]="st.busy" [matTooltip]="st.busy && st.session ? (st.session.userName + ' · ' + (st.session.stageName || '')) : 'Idle'">
                <div class="st-top"><mat-icon>{{ st.busy ? 'precision_manufacturing' : 'check_circle' }}</mat-icon><span class="st-name">{{ st.name }}</span></div>
                @if (st.busy && st.session) {
                  <div class="st-occ">{{ st.session.userName }}</div>
                  <div class="st-meta">{{ st.session.orderNumber }}{{ st.session.mark ? ' · ' + st.session.mark : '' }} · {{ elapsedFromSec(st.session.elapsedSeconds) | duration }}</div>
                } @else {
                  <div class="st-occ idle">Idle</div>
                  <div class="st-meta">{{ st.lineName || '' }}</div>
                }
              </div>
            }
          </div>
        }
      } @else if (floorError) {
        <p class="banner err"><mat-icon>error</mat-icon>{{ floorError }} <button class="link" (click)="loadFloor()">Retry</button></p>
      } @else {
        <div class="center"><mat-spinner diameter="30"></mat-spinner></div>
      }
    }

    <!-- ───────────── BY WORK ORDER ───────────── -->
    @if (view === 'workorder') {
      <div class="wo-pick">
        <mat-icon>search</mat-icon>
        <input type="text" [(ngModel)]="woFilter" placeholder="Filter work orders by number or piece mark…">
        @if (selectedWorkOrderId) { <button class="btn ghost sm" (click)="selectedWorkOrderId = ''">Change</button> }
      </div>

      @if (!selectedWorkOrderId) {
        <div class="wo-list">
          @for (wo of filteredWorkOrders(); track wo.id) {
            <button class="wo-row" (click)="selectedWorkOrderId = wo.id">
              <span class="wo-num">{{ wo.orderNumber }}</span>
              <span class="wo-mark">{{ wo.mark || '—' }}</span>
              <span class="chip st-{{ wo.status }}">{{ wo.status.replace('_', ' ') }}</span>
            </button>
          }
          @if (filteredWorkOrders().length === 0) { <p class="muted pad">No work orders match.</p> }
        </div>
      } @else {
        <app-work-order-time [workOrderId]="selectedWorkOrderId"></app-work-order-time>
      }
    }
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    h2 { margin: 0; color: var(--clay-text); }

    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--clay-border); margin-bottom: 16px; }
    .tab { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; font-size: 13px; font-weight: 600; color: var(--clay-text-muted); background: none; border: none; border-bottom: 2.5px solid transparent; cursor: pointer; font-family: inherit; }
    .tab mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .tab.active { color: var(--clay-primary); border-bottom-color: var(--clay-primary); }

    .kpis { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
    .kpi { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 10px 18px; box-shadow: var(--clay-shadow-soft); min-width: 120px; }
    .k-val { display: block; font-size: 24px; font-weight: 800; color: var(--clay-text); line-height: 1.1; }
    .k-sub { font-size: 15px; color: var(--clay-text-muted); font-weight: 600; }
    .k-lbl { font-size: 11.5px; color: var(--clay-text-muted); text-transform: uppercase; letter-spacing: .03em; }
    .spacer { flex: 1 1 auto; }

    .clockin { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 14px; margin-bottom: 14px; box-shadow: var(--clay-shadow-soft); }
    .ci-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
    .fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); }
    .fld select { padding: 8px 10px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); font-size: 13px; min-width: 180px; background: var(--clay-surface); color: var(--clay-text); font-family: inherit; }
    .chk { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--clay-text); cursor: pointer; padding-bottom: 8px; }

    .sec { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 700; color: var(--clay-text); margin: 18px 0 10px; }
    .sec mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--clay-text-muted); }
    .center { display: flex; justify-content: center; padding: 40px 0; }
    .empty { text-align: center; padding: 28px; color: var(--clay-text-muted); }
    .empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .3; }
    .pad { padding: 8px 0; } .muted { color: var(--clay-text-muted); } .sm { font-size: 11px; } .strong { font-weight: 600; color: var(--clay-text); }

    .banner { display: flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 10px 12px; font-size: 13px; margin: 0 0 12px; background: var(--danger-bg); color: var(--danger-text); }
    .link { background: none; border: none; padding: 0 0 0 6px; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }

    .table-wrap { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); overflow-x: auto; box-shadow: var(--clay-shadow-soft); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: var(--clay-text-muted); padding: 9px 12px; border-bottom: 1px solid var(--clay-border); white-space: nowrap; }
    td { padding: 8px 12px; border-bottom: 1px solid var(--clay-border); }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: var(--clay-bg-warm); }
    .num { text-align: right; white-space: nowrap; } th.num { text-align: right; }
    td a { color: var(--clay-primary); font-weight: 600; cursor: pointer; }
    .live { color: var(--success-text); font-weight: 600; }

    .tag { padding: 1px 8px; border-radius: var(--clay-radius-xs); font-size: 11px; font-weight: 700; }
    .tag.run { background: var(--info-bg); color: var(--clay-primary); }
    .tag.setup { background: var(--warning-bg); color: var(--warning-text); }
    .tag.rework { background: var(--danger-bg); color: var(--danger-text); }

    .stations { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
    .station { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 11px 13px; box-shadow: var(--clay-shadow-soft); }
    .station.busy { border-color: var(--success); background: var(--success-bg); }
    .st-top { display: flex; align-items: center; gap: 6px; }
    .st-top mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); }
    .station.busy .st-top mat-icon { color: var(--success-text); }
    .st-name { font-size: 13px; font-weight: 700; color: var(--clay-text); }
    .st-occ { font-size: 13px; font-weight: 600; color: var(--clay-text); margin-top: 5px; }
    .st-occ.idle { color: var(--clay-text-muted); font-weight: 500; }
    .st-meta { font-size: 11px; color: var(--clay-text-muted); }

    .wo-pick { display: flex; align-items: center; gap: 8px; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 8px 12px; margin-bottom: 14px; }
    .wo-pick mat-icon { color: var(--clay-text-muted); }
    .wo-pick input { flex: 1; border: none; background: none; font-size: 14px; color: var(--clay-text); font-family: inherit; outline: none; }
    .wo-list { display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow: auto; }
    .wo-row { display: flex; align-items: center; gap: 14px; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 10px 14px; cursor: pointer; font-family: inherit; text-align: left; }
    .wo-row:hover { border-color: var(--clay-primary); background: var(--clay-bg-warm); }
    .wo-num { font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk', monospace; }
    .wo-mark { color: var(--clay-text-secondary); flex: 1; }
    .chip { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: capitalize; white-space: nowrap; }
    .st-draft, .st-pending, .st-cancelled { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .st-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .st-completed { background: var(--success-bg); color: var(--success-text); }

    .btn { display: inline-flex; align-items: center; gap: 5px; border-radius: var(--clay-radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; border: 1px solid var(--clay-border); text-decoration: none; }
    .btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .btn.sm { padding: 6px 11px; font-size: 12px; } .btn.xs { padding: 4px 9px; font-size: 11.5px; }
    .btn.ghost { background: transparent; color: var(--clay-text-secondary); }
    .btn.primary { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
    .btn.warn { background: transparent; color: var(--danger-text); border-color: var(--danger-text); }
    .btn:disabled { opacity: .5; cursor: default; }
  `],
})
export class TimeTrackingLiveComponent implements OnInit, OnDestroy {
  private svc = inject(TimeTrackingService);
  private auth = inject(AuthService);
  private perms = inject(PermissionsService);
  private route = inject(ActivatedRoute);
  private snack = inject(MatSnackBar);

  view: 'floor' | 'workorder' = 'floor';

  floor: FloorStatus | null = null;
  floorError: string | null = null;
  busy = false;

  // Clock-in form
  showClockIn = false;
  workOrders: LookupWorkOrder[] = [];
  stations: LookupStation[] = [];
  ciWorkOrder = '';
  ciStages: any[] = [];
  ciStage = '';
  ciStation = '';
  ciSetup = false;

  // Work-order view
  woFilter = '';
  selectedWorkOrderId = '';

  private refreshSub?: Subscription;
  private tickSub?: Subscription;
  now = Date.now();

  get myUserId(): string | null { return this.auth.currentUser?.id ?? null; }
  get canTrack(): boolean { return this.perms.can('time-tracking.track'); }
  get myActive(): boolean { return !!this.floor?.sessions.some((s) => s.userId === this.myUserId); }

  ngOnInit(): void {
    const pre = this.route.snapshot.queryParamMap.get('workOrder');
    if (pre) { this.view = 'workorder'; this.selectedWorkOrderId = pre; }
    this.loadFloor();
    this.loadLookups();
    this.refreshSub = interval(10000).subscribe(() => this.loadFloor());
    this.tickSub = interval(1000).subscribe(() => { this.now = Date.now(); });
  }
  ngOnDestroy(): void { this.refreshSub?.unsubscribe(); this.tickSub?.unsubscribe(); }

  loadFloor(): void {
    this.svc.floor().subscribe({
      next: (f) => { this.floor = f; this.floorError = null; },
      error: (e) => { if (!this.floor) this.floorError = e?.error?.message || 'Could not load floor status.'; },
    });
  }

  loadLookups(): void {
    this.svc.listWorkOrders().subscribe({ next: (w) => (this.workOrders = w), error: () => (this.workOrders = []) });
    this.svc.listStations().subscribe({ next: (s) => (this.stations = s), error: () => (this.stations = []) });
  }

  // ── Floor: live elapsed ──
  elapsed(startTime: string): number {
    if (!startTime) return 0;
    return Math.max(0, Math.floor((this.now - new Date(startTime).getTime()) / 1000));
  }
  /** Station occupancy elapsed is server-computed at fetch; advance it with the local tick. */
  elapsedFromSec(base: number): number {
    return base + Math.floor((this.now - (this.floor ? new Date(this.floor.generatedAt).getTime() : this.now)) / 1000);
  }

  // ── Clock in/out ──
  toggleClockIn(): void { this.showClockIn = !this.showClockIn; }
  onCiWorkOrder(): void {
    this.ciStage = '';
    this.ciStages = [];
    if (!this.ciWorkOrder) return;
    this.svc.workOrderSummary(this.ciWorkOrder).subscribe({
      next: (s) => { this.ciStages = s.stages.map((st) => ({ id: st.workOrderStageId, stage: { name: st.name } })); },
      error: () => { this.ciStages = []; },
    });
  }
  clockIn(): void {
    if (!this.ciStage) return;
    this.busy = true;
    this.svc.clockIn({ workOrderStageId: this.ciStage, stationId: this.ciStation || null, isSetup: this.ciSetup, inputMethod: 'web' }).subscribe({
      next: () => { this.busy = false; this.showClockIn = false; this.ciWorkOrder = ''; this.ciStage = ''; this.ciStation = ''; this.ciSetup = false; this.snack.open('Clocked in', 'OK', { duration: 2500 }); this.loadFloor(); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Could not clock in', 'Dismiss', { duration: 4000 }); },
    });
  }
  clockOut(s: FloorSession): void {
    this.busy = true;
    this.svc.clockOut(s.id).subscribe({
      next: () => { this.busy = false; this.snack.open('Clocked out', 'OK', { duration: 2500 }); this.loadFloor(); },
      error: (e) => { this.busy = false; this.snack.open(e?.error?.message || 'Could not clock out', 'Dismiss', { duration: 4000 }); },
    });
  }

  // ── Work-order view ──
  openWorkOrder(id: string): void { this.view = 'workorder'; this.selectedWorkOrderId = id; }
  filteredWorkOrders(): LookupWorkOrder[] {
    const q = this.woFilter.trim().toLowerCase();
    if (!q) return this.workOrders;
    return this.workOrders.filter((w) => w.orderNumber?.toLowerCase().includes(q) || (w.mark || '').toLowerCase().includes(q));
  }
}
