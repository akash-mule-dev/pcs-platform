import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subscription, interval, merge } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import {
  StationsService, StationRow, StationUtilRow, Line, StationStatus, StationType,
  STATION_TYPES, STATION_STATUSES,
} from '../core/services/stations.service';
import { PermissionsService } from '../core/services/permissions.service';
import { RealtimeService } from '../core/services/realtime.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';

/** Title-case a snake/lower token for display (fit_up → "Fit Up"). */
const titleize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

interface StationForm {
  id: string | null;
  name: string;
  lineId: string;
  code: string;
  description: string;
  type: StationType;
  status: StationStatus;
  machineRate: number | null;
  availableHoursPerDay: number | null;
  isActive: boolean;
}

/**
 * Work-Center directory — the org-wide station register. KPI strip + filterable
 * table with live busy badges and a 7/30/90-day utilization column; each row
 * drills into the per-station cockpit (/stations/:id). Create/edit/status/delete
 * and line management are permission-gated; the board live-updates from the
 * station-update / time-entry-update websocket events with a poll fallback.
 */
@Component({
  selector: 'app-stations-directory',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="page-header">
      <h2>Work Centers</h2>
      <div class="hdr-actions">
        <button class="btn ghost" (click)="showLines.set(!showLines())"><mat-icon>account_tree</mat-icon>Lines</button>
        @if (canManage) { <button class="btn primary" (click)="openCreate()"><mat-icon>add</mat-icon>New station</button> }
      </div>
    </div>

    <!-- KPIs -->
    <div class="kpis">
      <div class="kpi"><span class="k-val">{{ kpis().total }}</span><span class="k-lbl">Work centers</span></div>
      <div class="kpi"><span class="k-val">{{ kpis().active }}</span><span class="k-lbl">Active</span></div>
      <div class="kpi"><span class="k-val">{{ kpis().busy }}<span class="k-sub">/{{ kpis().active }}</span></span><span class="k-lbl">Busy now</span></div>
      <div class="kpi"><span class="k-val">{{ kpis().rated }}</span><span class="k-lbl">Rated</span></div>
      <div class="spacer"></div>
      <label class="win">Utilization window
        <select [(ngModel)]="windowDays" (ngModelChange)="loadUtil()">
          <option [ngValue]="7">Last 7 days</option>
          <option [ngValue]="30">Last 30 days</option>
          <option [ngValue]="90">Last 90 days</option>
        </select>
      </label>
    </div>

    <!-- Lines management -->
    @if (showLines()) {
      <div class="panel">
        <div class="panel-head"><mat-icon>account_tree</mat-icon><strong>Production lines</strong><span class="spacer"></span>
          <button class="btn ghost xs" (click)="showLines.set(false)"><mat-icon>close</mat-icon></button>
        </div>
        @if (canManage) {
          <div class="line-add">
            <input [(ngModel)]="newLineName" placeholder="New line name">
            <input [(ngModel)]="newLineDesc" placeholder="Description (optional)">
            <button class="btn primary sm" [disabled]="!newLineName.trim() || savingLine()" (click)="addLine()">Add line</button>
          </div>
        }
        <div class="line-list">
          @for (ln of lines(); track ln.id) {
            <div class="line-row">
              @if (editLineId() === ln.id) {
                <input class="grow" [(ngModel)]="editLineName">
                <input class="grow" [(ngModel)]="editLineDesc" placeholder="Description">
                <button class="btn primary xs" (click)="saveLine(ln)">Save</button>
                <button class="btn ghost xs" (click)="editLineId.set(null)">Cancel</button>
              } @else {
                <mat-icon>factory</mat-icon>
                <span class="ln-name">{{ ln.name }}</span>
                <span class="ln-count">{{ (ln.stations?.length || 0) }} station(s)</span>
                <span class="ln-desc">{{ ln.description || '' }}</span>
                <span class="spacer"></span>
                @if (canManage) { <button class="icon-btn" (click)="startEditLine(ln)" matTooltip="Edit"><mat-icon>edit</mat-icon></button> }
                @if (canDeleteLine) { <button class="icon-btn danger" (click)="deleteLine(ln)" matTooltip="Delete line"><mat-icon>delete</mat-icon></button> }
              }
            </div>
          }
          @if (lines().length === 0) { <p class="muted pad">No lines yet.</p> }
        </div>
      </div>
    }

    <!-- Filters -->
    <div class="filters">
      <div class="search"><mat-icon>search</mat-icon>
        <input [(ngModel)]="q" placeholder="Search name or code…">
        @if (q) { <button class="icon-btn" (click)="q = ''"><mat-icon>close</mat-icon></button> }
      </div>
      <select [(ngModel)]="fLine"><option value="">All lines</option>@for (ln of lines(); track ln.id) { <option [value]="ln.id">{{ ln.name }}</option> }</select>
      <select [(ngModel)]="fType"><option value="">All types</option>@for (t of types; track t) { <option [value]="t">{{ label(t) }}</option> }</select>
      <select [(ngModel)]="fStatus"><option value="">Any status</option>@for (s of statuses; track s) { <option [value]="s">{{ label(s) }}</option> }</select>
      <select [(ngModel)]="fActive"><option value="all">Active & inactive</option><option value="true">Active only</option><option value="false">Inactive only</option></select>
    </div>

    <!-- Table -->
    @if (loading()) {
      <div class="center"><mat-spinner diameter="30"></mat-spinner></div>
    } @else if (error()) {
      <p class="banner err"><mat-icon>error</mat-icon>{{ error() }} <button class="link" (click)="load()">Retry</button></p>
    } @else if (visibleRows().length === 0) {
      <div class="empty"><mat-icon>precision_manufacturing</mat-icon>
        <p>{{ rows().length === 0 ? 'No work centers yet.' : 'No stations match your filters.' }}</p>
        @if (rows().length === 0 && canManage) { <button class="btn primary sm" (click)="openCreate()"><mat-icon>add</mat-icon>Add the first station</button> }
      </div>
    } @else {
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Station</th><th>Line</th><th>Type</th><th>Status</th>
            <th class="num">Util ({{ windowDays }}d)</th><th class="num">Hours</th>
            @if (canSeeCost) { <th class="num">Rate /h</th> }
            <th class="num">Equip.</th><th></th>
          </tr></thead>
          <tbody>
            @for (s of visibleRows(); track s.id) {
              <tr [class.inactive]="!s.isActive">
                <td>
                  <a class="st-link" [routerLink]="['/stations', s.id]">{{ s.name }}</a>
                  @if (s.code) { <span class="code">{{ s.code }}</span> }
                  @if (!s.isActive) { <span class="tag off">Inactive</span> }
                </td>
                <td class="muted">{{ s.lineName || '—' }}</td>
                <td class="muted">{{ label(s.type) }}</td>
                <td>
                  <span class="dot" [class.busy]="s.busy" [matTooltip]="s.busy ? (s.occupant || 'In use') : 'Idle'"></span>
                  <span class="chip ss-{{ s.status }}">{{ label(s.status) }}</span>
                  @if (s.busy && s.occupant) { <span class="muted sm occ">· {{ s.occupant }}</span> }
                </td>
                <td class="num">
                  @if (utilOf(s.id)?.utilizationPct != null) {
                    <div class="util" [matTooltip]="utilOf(s.id)!.utilizationPct + '% of capacity'">
                      <div class="util-bar"><span [style.width.%]="barWidth(utilOf(s.id)!.utilizationPct)" [class.over]="utilOf(s.id)!.utilizationPct! > 100"></span></div>
                      <span class="util-pct">{{ utilOf(s.id)!.utilizationPct }}%</span>
                    </div>
                  } @else { <span class="muted" matTooltip="Set hours/day on the station to see utilization %">—</span> }
                </td>
                <td class="num">{{ (utilOf(s.id)?.attendedHours ?? 0) | number:'1.0-1' }}h</td>
                @if (canSeeCost) { <td class="num">{{ s.machineRate != null ? (s.machineRate | number:'1.0-2') : '—' }}</td> }
                <td class="num">{{ s.equipmentCount || '—' }}</td>
                <td class="num actions">
                  @if (canOperate) {
                    <select class="status-sel" [ngModel]="s.status" (ngModelChange)="setStatus(s, $event)" [disabled]="busyId() === s.id" matTooltip="Set status">
                      @for (st of statuses; track st) { <option [value]="st">{{ label(st) }}</option> }
                    </select>
                  }
                  @if (canManage) { <button class="icon-btn" (click)="openEdit(s)" matTooltip="Edit"><mat-icon>edit</mat-icon></button> }
                  @if (canDelete) { <button class="icon-btn danger" (click)="deleteStation(s)" [disabled]="busyId() === s.id" matTooltip="Delete"><mat-icon>delete</mat-icon></button> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <!-- Create / edit station modal -->
    @if (showForm()) {
      <div class="backdrop" (click)="showForm.set(false)"></div>
      <div class="modal">
        <div class="modal-head"><strong>{{ form.id ? 'Edit station' : 'New station' }}</strong>
          <button class="icon-btn" (click)="showForm.set(false)"><mat-icon>close</mat-icon></button>
        </div>
        <div class="modal-body">
          <label class="fld"><span>Name *</span><input [(ngModel)]="form.name" placeholder="e.g. Weld bay 3"></label>
          <div class="two">
            <label class="fld"><span>Code</span><input [(ngModel)]="form.code" placeholder="e.g. WELD-3"></label>
            <label class="fld"><span>Line *</span>
              <select [(ngModel)]="form.lineId">
                <option value="" disabled>Select a line</option>
                @for (ln of lines(); track ln.id) { <option [value]="ln.id">{{ ln.name }}</option> }
              </select>
            </label>
          </div>
          <div class="two">
            <label class="fld"><span>Type</span><select [(ngModel)]="form.type">@for (t of types; track t) { <option [value]="t">{{ label(t) }}</option> }</select></label>
            <label class="fld"><span>Status</span><select [(ngModel)]="form.status">@for (s of statuses; track s) { <option [value]="s">{{ label(s) }}</option> }</select></label>
          </div>
          <div class="two">
            @if (canSeeCost) {
              <label class="fld"><span>Machine rate /h</span><input type="number" min="0" step="0.01" [(ngModel)]="form.machineRate" placeholder="0.00">
                <small>Burden rate — drives machine cost</small></label>
            }
            <label class="fld"><span>Available hours/day</span><input type="number" min="0" step="0.25" [(ngModel)]="form.availableHoursPerDay" placeholder="e.g. 8">
              <small>Capacity basis for utilization %</small></label>
          </div>
          <label class="fld"><span>Description</span><textarea rows="2" [(ngModel)]="form.description"></textarea></label>
          @if (form.id) { <label class="chk"><input type="checkbox" [(ngModel)]="form.isActive"> Active</label> }
          @if (formError()) { <p class="banner err sm"><mat-icon>error</mat-icon>{{ formError() }}</p> }
        </div>
        <div class="modal-foot">
          <button class="btn ghost" (click)="showForm.set(false)">Cancel</button>
          <button class="btn primary" [disabled]="!form.name.trim() || !form.lineId || saving()" (click)="saveStation()">{{ form.id ? 'Save' : 'Create' }}</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    h2 { margin: 0; color: var(--clay-text); }
    .hdr-actions { display: flex; gap: 8px; }

    .kpis { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
    .kpi { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 10px 18px; box-shadow: var(--clay-shadow-soft); min-width: 110px; }
    .k-val { display: block; font-size: 24px; font-weight: 800; color: var(--clay-text); line-height: 1.1; font-family: 'Space Grotesk', monospace; }
    .k-sub { font-size: 15px; color: var(--clay-text-muted); font-weight: 600; }
    .k-lbl { font-size: 11.5px; color: var(--clay-text-muted); text-transform: uppercase; letter-spacing: .03em; }
    .spacer { flex: 1 1 auto; }
    .win { display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-weight: 600; color: var(--clay-text-muted); text-transform: uppercase; }
    .win select { padding: 6px 8px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); font-family: inherit; font-size: 13px; }

    .panel { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 14px; margin-bottom: 14px; box-shadow: var(--clay-shadow-soft); }
    .panel-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; color: var(--clay-text); }
    .panel-head mat-icon { color: var(--clay-text-muted); }
    .line-add { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .line-add input { flex: 1; min-width: 140px; padding: 8px 10px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); font-family: inherit; }
    .line-list { display: flex; flex-direction: column; gap: 6px; }
    .line-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); }
    .line-row mat-icon { color: var(--clay-accent); font-size: 18px; width: 18px; height: 18px; }
    .line-row input { padding: 6px 8px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); font-family: inherit; }
    .line-row .grow { flex: 1; }
    .ln-name { font-weight: 700; color: var(--clay-text); }
    .ln-count { font-size: 11.5px; color: var(--clay-text-muted); }
    .ln-desc { font-size: 12px; color: var(--clay-text-secondary); }

    .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .filters select { padding: 8px 10px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); font-family: inherit; font-size: 13px; }
    .search { display: flex; align-items: center; gap: 6px; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); padding: 4px 10px; flex: 1; min-width: 200px; }
    .search mat-icon { color: var(--clay-text-muted); font-size: 18px; width: 18px; height: 18px; }
    .search input { flex: 1; border: none; background: none; outline: none; color: var(--clay-text); font-family: inherit; font-size: 14px; }

    .center { display: flex; justify-content: center; padding: 40px 0; }
    .empty { text-align: center; padding: 36px; color: var(--clay-text-muted); display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .empty mat-icon { font-size: 44px; width: 44px; height: 44px; opacity: .3; }
    .banner { display: flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 10px 12px; font-size: 13px; margin: 8px 0; background: var(--danger-bg); color: var(--danger-text); }
    .banner.sm { padding: 7px 10px; font-size: 12px; }
    .link { background: none; border: none; padding: 0 0 0 6px; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
    .muted { color: var(--clay-text-muted); } .sm { font-size: 11px; } .pad { padding: 8px 0; }

    .table-wrap { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); overflow-x: auto; box-shadow: var(--clay-shadow-soft); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: var(--clay-text-muted); padding: 9px 12px; border-bottom: 1px solid var(--clay-border); white-space: nowrap; }
    td { padding: 8px 12px; border-bottom: 1px solid var(--clay-border); vertical-align: middle; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: var(--clay-bg-warm); }
    tr.inactive { opacity: .55; }
    .num { text-align: right; white-space: nowrap; } th.num { text-align: right; }
    .actions { display: flex; gap: 4px; justify-content: flex-end; align-items: center; }
    .st-link { color: var(--clay-primary); font-weight: 700; cursor: pointer; text-decoration: none; }
    .st-link:hover { text-decoration: underline; }
    .code { display: inline-block; margin-left: 8px; font-family: 'Space Grotesk', monospace; font-size: 11px; color: var(--clay-text-muted); }
    .occ { margin-left: 6px; }

    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--clay-text-muted); opacity: .4; margin-right: 6px; vertical-align: middle; }
    .dot.busy { background: var(--success); opacity: 1; box-shadow: 0 0 0 3px var(--success-bg); }
    .chip { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: capitalize; white-space: nowrap; }
    .ss-available { background: var(--success-bg); color: var(--success-text); }
    .ss-running { background: var(--info-bg); color: var(--clay-primary); }
    .ss-idle { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .ss-setup { background: var(--warning-bg); color: var(--warning-text); }
    .ss-down, .ss-offline { background: var(--danger-bg); color: var(--danger-text); }
    .ss-maintenance { background: var(--warning-bg); color: var(--warning-text); }
    .tag { padding: 1px 7px; border-radius: var(--clay-radius-xs); font-size: 10.5px; font-weight: 700; }
    .tag.off { background: var(--badge-draft-bg); color: var(--badge-draft-text); margin-left: 6px; }

    .util { display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end; }
    .util-bar { width: 54px; height: 6px; border-radius: 999px; background: var(--clay-border); overflow: hidden; }
    .util-bar span { display: block; height: 100%; background: var(--clay-primary); border-radius: 999px; }
    .util-bar span.over { background: var(--danger-text); }
    .util-pct { font-size: 11.5px; font-weight: 700; color: var(--clay-text); min-width: 34px; }

    .status-sel { padding: 3px 6px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); font-family: inherit; font-size: 11.5px; }
    .icon-btn { background: none; border: none; cursor: pointer; color: var(--clay-text-muted); display: inline-flex; padding: 4px; border-radius: var(--clay-radius-xs); }
    .icon-btn:hover { background: var(--clay-bg-warm); color: var(--clay-text); }
    .icon-btn.danger:hover { color: var(--danger-text); }
    .icon-btn mat-icon, .status-sel + .icon-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .icon-btn:disabled { opacity: .4; cursor: default; }

    .btn { display: inline-flex; align-items: center; gap: 5px; border-radius: var(--clay-radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; border: 1px solid var(--clay-border); text-decoration: none; color: var(--clay-text); background: var(--clay-surface); }
    .btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .btn.sm { padding: 6px 11px; font-size: 12px; } .btn.xs { padding: 4px 8px; font-size: 11.5px; }
    .btn.ghost { background: transparent; color: var(--clay-text-secondary); }
    .btn.primary { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
    .btn:disabled { opacity: .5; cursor: default; }

    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 40; }
    .modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(560px, 94vw); max-height: 90vh; overflow: auto; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); box-shadow: var(--clay-shadow-raised); z-index: 41; }
    .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--clay-border); color: var(--clay-text); }
    .modal-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--clay-border); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); }
    .fld input, .fld select, .fld textarea { padding: 8px 10px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); font-family: inherit; font-size: 13px; }
    .fld small { font-weight: 500; color: var(--clay-text-muted); font-size: 10.5px; }
    .chk { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--clay-text); cursor: pointer; }
    @media (max-width: 560px) { .two { grid-template-columns: 1fr; } }
  `],
})
export class StationsDirectoryComponent implements OnInit, OnDestroy {
  private svc = inject(StationsService);
  private perms = inject(PermissionsService);
  private rt = inject(RealtimeService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  rows = signal<StationRow[]>([]);
  private utilMap = signal<Map<string, StationUtilRow>>(new Map());
  lines = signal<Line[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  busyId = signal<string | null>(null);

  windowDays = 7;
  types = STATION_TYPES;
  statuses = STATION_STATUSES;

  // Filters (client-side over the fetched set)
  q = '';
  fLine = '';
  fType = '';
  fStatus = '';
  fActive: 'all' | 'true' | 'false' = 'all';

  // Lines panel
  showLines = signal(false);
  newLineName = '';
  newLineDesc = '';
  savingLine = signal(false);
  editLineId = signal<string | null>(null);
  editLineName = '';
  editLineDesc = '';

  // Station form
  showForm = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);
  form: StationForm = this.blankForm();

  private subs: Subscription[] = [];

  get canManage() { return this.perms.can('stations.manage'); }
  get canOperate() { return this.perms.can('stations.operate'); }
  get canDelete() { return this.perms.can('stations.delete-station'); }
  get canDeleteLine() { return this.perms.can('stations.delete'); }
  get canSeeCost() { return this.perms.can('costing.view'); }

  kpis = computed(() => {
    const r = this.rows();
    return {
      total: r.length,
      active: r.filter((s) => s.isActive).length,
      busy: r.filter((s) => s.busy).length,
      rated: r.filter((s) => s.hasMachineRate).length,
    };
  });

  // Plain method (not a computed): it must re-evaluate every change-detection
  // cycle as the user types / changes the dropdowns. A computed() would only
  // react to signal reads, and the filter fields below are plain ngModel state —
  // so it would memoize and the filters would appear dead. Mirrors the
  // filteredWorkOrders() method pattern in the time-tracking console.
  visibleRows(): StationRow[] {
    const q = this.q.trim().toLowerCase();
    return this.rows().filter((s) => {
      if (this.fLine && s.lineId !== this.fLine) return false;
      if (this.fType && s.type !== this.fType) return false;
      if (this.fStatus && s.status !== this.fStatus) return false;
      if (this.fActive === 'true' && !s.isActive) return false;
      if (this.fActive === 'false' && s.isActive) return false;
      if (q && !(s.name.toLowerCase().includes(q) || (s.code || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }

  ngOnInit(): void {
    this.load();
    this.loadUtil();
    this.subs.push(
      merge(this.rt.on('station-update'), this.rt.on('time-entry-update'), this.rt.on('work-order-update'))
        .pipe(debounceTime(500))
        .subscribe(() => this.reloadSilent()),
    );
    this.subs.push(interval(30000).subscribe(() => { if (!document.hidden) this.reloadSilent(); }));
  }
  ngOnDestroy(): void { this.subs.forEach((s) => s.unsubscribe()); }

  label = (s: string) => titleize(s);
  utilOf(id: string): StationUtilRow | undefined { return this.utilMap().get(id); }
  barWidth(pct: number | null): number { return Math.min(100, Math.max(0, pct ?? 0)); }

  load(): void {
    this.loading.set(true);
    this.svc.list().subscribe({
      next: (r) => { this.rows.set(r); this.loading.set(false); this.error.set(null); },
      error: (e) => { this.loading.set(false); this.error.set(e?.error?.message || 'Could not load work centers.'); },
    });
    this.svc.listLines().subscribe({ next: (l) => this.lines.set(l), error: () => this.lines.set([]) });
  }

  private reloadSilent(): void {
    this.svc.list().subscribe({ next: (r) => this.rows.set(r), error: () => {} });
    this.svc.listLines().subscribe({ next: (l) => this.lines.set(l), error: () => {} });
  }

  loadUtil(): void {
    const from = new Date(Date.now() - (this.windowDays - 1) * 86400000).toISOString().slice(0, 10);
    this.svc.utilization({ from }).subscribe({
      next: (u) => { this.utilMap.set(new Map(u.stations.map((s) => [s.stationId, s]))); },
      error: () => { this.utilMap.set(new Map()); },
    });
  }

  // ── Station status / delete ──
  setStatus(s: StationRow, status: StationStatus): void {
    if (status === s.status) return;
    this.busyId.set(s.id);
    this.svc.setStatus(s.id, status).subscribe({
      next: () => { this.busyId.set(null); this.snack.open(`${s.name} → ${this.label(status)}`, 'OK', { duration: 2000 }); this.reloadSilent(); },
      error: (e) => { this.busyId.set(null); this.snack.open(e?.error?.message || 'Could not change status', 'Dismiss', { duration: 4000 }); this.reloadSilent(); },
    });
  }

  deleteStation(s: StationRow): void {
    const ref = this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete station', message: `Delete "${s.name}"? In-use stations cannot be deleted — deactivate them instead.` } });
    ref.afterClosed().subscribe((ok) => {
      if (!ok) return;
      this.busyId.set(s.id);
      this.svc.remove(s.id).subscribe({
        next: () => { this.busyId.set(null); this.snack.open('Station deleted', 'OK', { duration: 2500 }); this.reloadSilent(); },
        error: (e) => { this.busyId.set(null); this.snack.open(e?.error?.message || 'Could not delete station', 'Dismiss', { duration: 6000 }); },
      });
    });
  }

  // ── Create / edit ──
  blankForm(): StationForm {
    return { id: null, name: '', lineId: '', code: '', description: '', type: 'other', status: 'available', machineRate: null, availableHoursPerDay: null, isActive: true };
  }
  openCreate(): void {
    this.form = this.blankForm();
    this.form.lineId = this.lines()[0]?.id || '';
    this.formError.set(null);
    this.showForm.set(true);
    if (this.lines().length === 0) this.svc.listLines().subscribe({ next: (l) => { this.lines.set(l); this.form.lineId = l[0]?.id || ''; } });
  }
  openEdit(s: StationRow): void {
    this.formError.set(null);
    this.showForm.set(true);
    this.svc.detail(s.id).subscribe({
      next: (d) => {
        this.form = {
          id: d.station.id, name: d.station.name, lineId: d.station.lineId, code: d.station.code || '',
          description: d.station.description || '', type: d.station.type, status: d.station.status,
          machineRate: d.station.machineRate, availableHoursPerDay: d.station.availableHoursPerDay, isActive: d.station.isActive,
        };
      },
      error: (e) => { this.formError.set(e?.error?.message || 'Could not load station'); },
    });
  }
  saveStation(): void {
    if (!this.form.name.trim() || !this.form.lineId) return;
    this.saving.set(true);
    this.formError.set(null);
    const body: any = {
      name: this.form.name.trim(),
      lineId: this.form.lineId,
      code: this.form.code.trim() || undefined,
      description: this.form.description.trim() || undefined,
      type: this.form.type,
      status: this.form.status,
    };
    if (this.canSeeCost && this.form.machineRate != null && this.form.machineRate !== ('' as any)) body.machineRate = Number(this.form.machineRate);
    if (this.form.availableHoursPerDay != null && this.form.availableHoursPerDay !== ('' as any)) body.availableHoursPerDay = Number(this.form.availableHoursPerDay);
    const done = {
      next: () => { this.saving.set(false); this.showForm.set(false); this.snack.open(this.form.id ? 'Station updated' : 'Station created', 'OK', { duration: 2500 }); this.reloadSilent(); this.loadUtil(); },
      error: (e: any) => { this.saving.set(false); this.formError.set(e?.error?.message || 'Could not save station'); },
    };
    if (this.form.id) {
      body.isActive = this.form.isActive;
      this.svc.update(this.form.id, body).subscribe(done);
    } else {
      this.svc.create(body).subscribe(done);
    }
  }

  // ── Lines ──
  addLine(): void {
    if (!this.newLineName.trim()) return;
    this.savingLine.set(true);
    this.svc.createLine({ name: this.newLineName.trim(), description: this.newLineDesc.trim() || undefined }).subscribe({
      next: () => { this.savingLine.set(false); this.newLineName = ''; this.newLineDesc = ''; this.snack.open('Line created', 'OK', { duration: 2000 }); this.refreshLines(); },
      error: (e) => { this.savingLine.set(false); this.snack.open(e?.error?.message || 'Could not create line', 'Dismiss', { duration: 4000 }); },
    });
  }
  startEditLine(ln: Line): void { this.editLineId.set(ln.id); this.editLineName = ln.name; this.editLineDesc = ln.description || ''; }
  saveLine(ln: Line): void {
    this.svc.updateLine(ln.id, { name: this.editLineName.trim(), description: this.editLineDesc.trim() }).subscribe({
      next: () => { this.editLineId.set(null); this.snack.open('Line updated', 'OK', { duration: 2000 }); this.refreshLines(); },
      error: (e) => { this.snack.open(e?.error?.message || 'Could not update line', 'Dismiss', { duration: 4000 }); },
    });
  }
  deleteLine(ln: Line): void {
    const ref = this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete line', message: `Delete "${ln.name}" and its stations?` } });
    ref.afterClosed().subscribe((ok) => {
      if (!ok) return;
      this.svc.removeLine(ln.id).subscribe({
        next: () => { this.snack.open('Line deleted', 'OK', { duration: 2500 }); this.refreshLines(); this.reloadSilent(); },
        error: (e) => { this.snack.open(e?.error?.message || 'Could not delete line', 'Dismiss', { duration: 5000 }); },
      });
    });
  }
  private refreshLines(): void { this.svc.listLines().subscribe({ next: (l) => this.lines.set(l), error: () => {} }); }
}
