import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subscription, interval, merge } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { StationsService, StationDetail, StationUtilRow, StationStatus, STATION_STATUSES } from '../core/services/stations.service';
import { PermissionsService } from '../core/services/permissions.service';
import { RealtimeService } from '../core/services/realtime.service';
import { DurationPipe } from '../shared/pipes/duration.pipe';

const titleize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Per-station cockpit: header (identity + operational status), live occupancy
 * (who's clocked in right now), the work-order queue routed to this station,
 * mounted equipment, and a utilization + cost panel over a selectable window.
 * Live via station-update / time-entry-update / stage-update with a poll fallback
 * and a 1-second local tick for the elapsed counters.
 */
@Component({
  selector: 'app-station-cockpit',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, DurationPipe],
  template: `
    @if (detail(); as d) {
      <a class="back" routerLink="/stations"><mat-icon>arrow_back</mat-icon>Work centers</a>

      <!-- Header -->
      <div class="head">
        <div class="head-main">
          <span class="dot" [class.busy]="d.occupancy.busy"></span>
          <h2>{{ d.station.name }}</h2>
          @if (d.station.code) { <span class="code">{{ d.station.code }}</span> }
          <span class="chip ss-{{ d.station.status }}">{{ label(d.station.status) }}</span>
          @if (!d.station.isActive) { <span class="tag off">Inactive</span> }
        </div>
        <div class="head-meta">
          <span><mat-icon>account_tree</mat-icon>{{ d.station.lineName || 'No line' }}</span>
          <span><mat-icon>category</mat-icon>{{ label(d.station.type) }}</span>
          @if (d.station.availableHoursPerDay != null) { <span><mat-icon>schedule</mat-icon>{{ d.station.availableHoursPerDay }} h/day</span> }
          @if (canSeeCost && d.station.machineRate != null) { <span><mat-icon>payments</mat-icon>{{ d.station.machineRate | number:'1.0-2' }}/h</span> }
        </div>
        @if (canOperate) {
          <label class="op">Status
            <select [ngModel]="d.station.status" (ngModelChange)="setStatus($event)" [disabled]="busy()">
              @for (s of statuses; track s) { <option [value]="s">{{ label(s) }}</option> }
            </select>
          </label>
        }
      </div>
      @if (d.station.description) { <p class="desc">{{ d.station.description }}</p> }

      <div class="grid">
        <!-- Live occupancy -->
        <section class="card">
          <h3><mat-icon>person_pin_circle</mat-icon>Live occupancy</h3>
          @if (d.occupancy.sessions.length === 0) {
            <div class="mini-empty"><mat-icon>nightlight</mat-icon><span>No one is clocked in here right now.</span></div>
          } @else {
            @for (s of d.occupancy.sessions; track s.id) {
              <div class="occ-row">
                <div class="occ-who"><strong>{{ s.userName }}</strong>
                  @if (s.isRework) { <span class="tag rework">Rework</span> } @else if (s.isSetup) { <span class="tag setup">Setup</span> } @else { <span class="tag run">Run</span> }
                </div>
                <div class="occ-meta">
                  {{ s.stageName || '—' }} ·
                  @if (s.productionOrderId) { <a [routerLink]="['/work-orders', s.productionOrderId]">{{ s.orderNumber }}</a> } @else { {{ s.orderNumber || '—' }} }
                  {{ s.mark ? ' · ' + s.mark : '' }}
                </div>
                <div class="occ-elapsed live">{{ elapsed(s.startTime) | duration }}</div>
              </div>
            }
          }
        </section>

        <!-- Utilization & cost -->
        <section class="card">
          <h3><mat-icon>monitoring</mat-icon>Utilization & cost
            <span class="spacer"></span>
            <select class="win" [(ngModel)]="windowDays" (ngModelChange)="loadUtil()">
              <option [ngValue]="7">7 days</option><option [ngValue]="30">30 days</option><option [ngValue]="90">90 days</option>
            </select>
          </h3>
          @if (util(); as u) {
            @if (u.utilizationPct != null) {
              <div class="util-big" [class.over]="u.utilizationPct > 100">
                <span class="util-num">{{ u.utilizationPct }}%</span>
                <span class="util-cap">{{ u.attendedHours | number:'1.0-1' }}h of {{ u.availableHours | number:'1.0-0' }}h available</span>
              </div>
            } @else {
              <div class="util-big">
                <span class="util-num">{{ u.attendedHours | number:'1.0-1' }}h</span>
                <span class="util-cap">attended · set hours/day to compute utilization %</span>
              </div>
            }
            <div class="stat-grid">
              <div><span class="s-val">{{ u.runHours | number:'1.0-1' }}h</span><span class="s-lbl">Run</span></div>
              <div><span class="s-val">{{ u.setupHours | number:'1.0-1' }}h</span><span class="s-lbl">Setup</span></div>
              <div><span class="s-val">{{ u.reworkHours | number:'1.0-1' }}h</span><span class="s-lbl">Rework</span></div>
              <div><span class="s-val">{{ u.idleHours | number:'1.0-1' }}h</span><span class="s-lbl">Idle</span></div>
              <div><span class="s-val">{{ u.operators }}</span><span class="s-lbl">Operators</span></div>
              <div><span class="s-val">{{ u.entries }}</span><span class="s-lbl">Entries</span></div>
              @if (canSeeCost) { <div><span class="s-val">{{ u.machineCost | number:'1.0-0' }}</span><span class="s-lbl">Machine cost</span></div> }
            </div>
          } @else {
            <div class="mini-empty"><span>No clocked time in this window.</span></div>
          }
        </section>

        <!-- Work-order queue -->
        <section class="card span2">
          <h3><mat-icon>list_alt</mat-icon>Work-order queue
            <span class="spacer"></span>
            <span class="q-counts">{{ d.queue.counts.inProgress }} in progress · {{ d.queue.counts.pending }} pending</span>
          </h3>
          @if (d.queue.items.length === 0) {
            <div class="mini-empty"><mat-icon>inbox</mat-icon><span>No work orders are routed to this station.</span></div>
          } @else {
            <div class="table-wrap">
              <table>
                <thead><tr><th>Work order</th><th>Piece</th><th>Stage</th><th>Status</th><th class="num">Done</th></tr></thead>
                <tbody>
                  @for (q of d.queue.items; track q.workOrderStageId) {
                    <tr>
                      <td>@if (q.productionOrderId) { <a [routerLink]="['/work-orders', q.productionOrderId]">{{ q.orderNumber }}</a> } @else { {{ q.orderNumber }} }</td>
                      <td class="muted">{{ q.mark || '—' }}</td>
                      <td class="muted">{{ q.stageName || '—' }}</td>
                      <td><span class="chip wss-{{ q.status }}">{{ label(q.status) }}</span></td>
                      <td class="num">{{ q.qtyDone }}@if (q.qtyTotal != null) { <span class="muted">/{{ q.qtyTotal }}</span> }</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <!-- Mounted equipment -->
        <section class="card span2">
          <h3><mat-icon>precision_manufacturing</mat-icon>Mounted equipment</h3>
          @if (d.equipment.length === 0) {
            <div class="mini-empty"><span>No equipment is assigned to this station.</span></div>
          } @else {
            <div class="equip-grid">
              @for (e of d.equipment; track e.id) {
                <div class="equip" [class.down]="e.status === 'down' || e.status === 'maintenance'">
                  <div class="eq-top"><span class="eq-name">{{ e.name }}</span><span class="chip eqs-{{ e.status }}">{{ label(e.status) }}</span></div>
                  <div class="eq-meta">{{ e.code }} · {{ label(e.type) }}@if (canSeeCost && e.hourlyRate != null) { · {{ e.hourlyRate | number:'1.0-2' }}/h }</div>
                </div>
              }
            </div>
          }
        </section>
      </div>
    } @else if (loading()) {
      <div class="center"><mat-spinner diameter="30"></mat-spinner></div>
    } @else if (error()) {
      <p class="banner err"><mat-icon>error</mat-icon>{{ error() }} <a class="link" routerLink="/stations">Back to work centers</a></p>
    }
  `,
  styles: [`
    .center { display: flex; justify-content: center; padding: 60px 0; }
    .banner { display: flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 10px 12px; font-size: 13px; background: var(--danger-bg); color: var(--danger-text); }
    .link { color: inherit; font-weight: 700; text-decoration: underline; margin-left: 6px; }
    .back { display: inline-flex; align-items: center; gap: 5px; color: var(--clay-text-secondary); text-decoration: none; font-size: 13px; font-weight: 600; margin-bottom: 12px; }
    .back mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .head-main { display: flex; align-items: center; gap: 10px; }
    .head-main h2 { margin: 0; color: var(--clay-text); }
    .dot { width: 11px; height: 11px; border-radius: 50%; background: var(--clay-text-muted); opacity: .4; }
    .dot.busy { background: var(--success); opacity: 1; box-shadow: 0 0 0 4px var(--success-bg); }
    .code { font-family: 'Space Grotesk', monospace; font-size: 13px; color: var(--clay-text-muted); }
    .head-meta { display: flex; gap: 16px; flex-wrap: wrap; color: var(--clay-text-secondary); font-size: 13px; }
    .head-meta span { display: inline-flex; align-items: center; gap: 5px; }
    .head-meta mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--clay-text-muted); }
    .op { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--clay-text-muted); }
    .op select { padding: 6px 8px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); font-family: inherit; }
    .desc { color: var(--clay-text-secondary); font-size: 13.5px; margin: 10px 0 0; }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; }
    .span2 { grid-column: 1 / -1; }
    .card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 16px; box-shadow: var(--clay-shadow-soft); }
    .card h3 { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 700; color: var(--clay-text); margin: 0 0 12px; }
    .card h3 mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--clay-text-muted); }
    .spacer { flex: 1 1 auto; }
    .win { padding: 4px 8px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); font-family: inherit; font-size: 12px; }

    .mini-empty { display: flex; align-items: center; gap: 8px; color: var(--clay-text-muted); font-size: 13px; padding: 14px 4px; }
    .mini-empty mat-icon { opacity: .4; }

    .occ-row { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 8px 0; border-bottom: 1px solid var(--clay-border); align-items: center; }
    .occ-row:last-child { border-bottom: none; }
    .occ-who { display: flex; align-items: center; gap: 8px; color: var(--clay-text); }
    .occ-meta { font-size: 12px; color: var(--clay-text-muted); grid-column: 1; }
    .occ-meta a { color: var(--clay-primary); font-weight: 600; }
    .occ-elapsed { grid-row: 1 / 3; grid-column: 2; align-self: center; font-weight: 700; }
    .live { color: var(--success-text); }

    .util-big { display: flex; flex-direction: column; gap: 2px; padding: 6px 0 12px; }
    .util-num { font-size: 32px; font-weight: 800; color: var(--clay-text); font-family: 'Space Grotesk', monospace; line-height: 1; }
    .util-big.over .util-num { color: var(--danger-text); }
    .util-cap { font-size: 12px; color: var(--clay-text-muted); }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 8px; }
    .stat-grid > div { background: var(--clay-bg-warm); border-radius: var(--clay-radius-xs); padding: 8px 10px; }
    .s-val { display: block; font-size: 16px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk', monospace; }
    .s-lbl { font-size: 10.5px; color: var(--clay-text-muted); text-transform: uppercase; letter-spacing: .03em; }

    .q-counts { font-size: 12px; color: var(--clay-text-muted); font-weight: 600; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: var(--clay-text-muted); padding: 7px 10px; border-bottom: 1px solid var(--clay-border); white-space: nowrap; }
    td { padding: 7px 10px; border-bottom: 1px solid var(--clay-border); }
    tbody tr:last-child td { border-bottom: none; }
    td a { color: var(--clay-primary); font-weight: 600; }
    .num { text-align: right; } th.num { text-align: right; }
    .muted { color: var(--clay-text-muted); }

    .equip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
    .equip { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 10px 12px; }
    .equip.down { border-color: var(--danger-text); background: var(--danger-bg); }
    .eq-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .eq-name { font-weight: 700; color: var(--clay-text); font-size: 13px; }
    .eq-meta { font-size: 11.5px; color: var(--clay-text-muted); margin-top: 3px; }

    .chip { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: capitalize; white-space: nowrap; }
    .ss-available { background: var(--success-bg); color: var(--success-text); }
    .ss-running { background: var(--info-bg); color: var(--clay-primary); }
    .ss-idle { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .ss-setup, .ss-maintenance { background: var(--warning-bg); color: var(--warning-text); }
    .ss-down, .ss-offline { background: var(--danger-bg); color: var(--danger-text); }
    .wss-pending { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .wss-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .eqs-running { background: var(--success-bg); color: var(--success-text); }
    .eqs-idle { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .eqs-down, .eqs-maintenance { background: var(--danger-bg); color: var(--danger-text); }
    .tag { padding: 1px 8px; border-radius: var(--clay-radius-xs); font-size: 10.5px; font-weight: 700; }
    .tag.run { background: var(--info-bg); color: var(--clay-primary); }
    .tag.setup { background: var(--warning-bg); color: var(--warning-text); }
    .tag.rework { background: var(--danger-bg); color: var(--danger-text); }
    .tag.off { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  `],
})
export class StationCockpitComponent implements OnInit, OnDestroy {
  private svc = inject(StationsService);
  private perms = inject(PermissionsService);
  private rt = inject(RealtimeService);
  private route = inject(ActivatedRoute);
  private snack = inject(MatSnackBar);

  detail = signal<StationDetail | null>(null);
  util = signal<StationUtilRow | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  busy = signal(false);

  windowDays = 7;
  statuses = STATION_STATUSES;
  private now = Date.now();
  private id = '';
  private subs: Subscription[] = [];

  get canOperate() { return this.perms.can('stations.operate'); }
  get canSeeCost() { return this.perms.can('costing.view'); }

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') || '';
    this.load();
    this.loadUtil();
    this.subs.push(
      merge(this.rt.on('station-update'), this.rt.on('time-entry-update'), this.rt.on('stage-update'), this.rt.on('work-order-update'))
        .pipe(debounceTime(500))
        .subscribe(() => this.reloadSilent()),
    );
    this.subs.push(interval(1000).subscribe(() => { this.now = Date.now(); }));
    this.subs.push(interval(30000).subscribe(() => { if (!document.hidden) this.reloadSilent(); }));
  }
  ngOnDestroy(): void { this.subs.forEach((s) => s.unsubscribe()); }

  label = (s: string) => titleize(s);
  elapsed(startTime: string): number { return startTime ? Math.max(0, Math.floor((this.now - new Date(startTime).getTime()) / 1000)) : 0; }

  load(): void {
    if (!this.id) { this.error.set('No station selected'); this.loading.set(false); return; }
    this.svc.detail(this.id).subscribe({
      next: (d) => { this.detail.set(d); this.loading.set(false); this.error.set(null); },
      error: (e) => { this.loading.set(false); this.error.set(e?.error?.message || 'Could not load this station.'); },
    });
  }
  private reloadSilent(): void {
    this.svc.detail(this.id).subscribe({ next: (d) => this.detail.set(d), error: () => {} });
  }
  loadUtil(): void {
    const from = new Date(Date.now() - (this.windowDays - 1) * 86400000).toISOString().slice(0, 10);
    this.svc.stationUtilization(this.id, { from }).subscribe({
      next: (u) => this.util.set(u.stations[0] ?? null),
      error: () => this.util.set(null),
    });
  }

  setStatus(status: StationStatus): void {
    const d = this.detail();
    if (!d || status === d.station.status) return;
    this.busy.set(true);
    this.svc.setStatus(this.id, status).subscribe({
      next: () => { this.busy.set(false); this.snack.open(`Status → ${this.label(status)}`, 'OK', { duration: 2000 }); this.reloadSilent(); },
      error: (e) => { this.busy.set(false); this.snack.open(e?.error?.message || 'Could not change status', 'Dismiss', { duration: 4000 }); this.reloadSilent(); },
    });
  }
}
