import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import {
  ProjectsService, OrderAudit, AuditItem, AuditStageRow, NodeAuditDetail, BulkStageResult, StageEventRow, ShipStatus,
} from '../core/services/projects.service';
import { RealtimeService } from '../core/services/realtime.service';
import * as QRCode from 'qrcode';

type StatusFilter = 'all' | 'not_started' | 'in_progress' | 'completed' | 'holds';
type BulkAction = 'completed' | 'in_progress' | 'pending' | 'skipped' | 'qty';

const ITEM_STATUS_LABEL: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };
const STAGE_STATUS_LABEL: Record<string, string> = { pending: 'Not started', in_progress: 'In progress', completed: 'Completed', skipped: 'Skipped' };
const ORDER_STATUS_LABEL: Record<string, string> = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
/** Rows rendered before "Show more" (keeps 500+ assembly orders snappy). */
const PAGE = 200;

/**
 * Per-order AUDIT dashboard (/work-orders/:id) — the single place where
 * everything about one work order is visible: assemblies on the left; the
 * selected assembly's full stage trail on the right (stepper, counts, stamps,
 * people, logged time, NCRs), with inline stage editing and BULK updates
 * across many assemblies at once. Production tracking deep-links (board /
 * quality / shipping) stay one click away.
 */
@Component({
  selector: 'app-work-order-audit',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="page">
      <a class="back" routerLink="/work-orders"><mat-icon>arrow_back</mat-icon><span>Work orders</span></a>

      @if (loading && !audit) {
        <div class="center"><mat-spinner diameter="36"></mat-spinner></div>
      } @else if (!audit) {
        <div class="empty-state"><mat-icon>receipt_long</mat-icon><h3>Couldn't load this work order</h3><p>{{ error || 'Try reloading.' }}</p></div>
      } @else {
        <!-- ── Header ── -->
        <header class="head">
          <div class="hrow">
            <div class="title">
              <mat-icon class="t-ico">receipt_long</mat-icon>
              @if (allOrders.length > 1) {
                <select class="order-switch" [ngModel]="orderId" (ngModelChange)="switchOrder($event)" matTooltip="Jump to another work order">
                  @for (o of allOrders; track o.id) { <option [value]="o.id">{{ o.number }} — {{ o.projectName }}</option> }
                </select>
              } @else {
                <h1>{{ audit.order.number }}</h1>
              }
              <span class="pill st-{{ audit.order.status }}">{{ orderStatusLabel(audit.order.status) }}</span>
            </div>
            <div class="actions">
              <button class="ghost" (click)="load()"><mat-icon>refresh</mat-icon>Refresh</button>
              <button class="ghost" [class.on]="bulkMode" (click)="toggleBulk()"><mat-icon>checklist</mat-icon>Bulk edit</button>
              <button class="ghost" [disabled]="labelsBusy" (click)="printLabels()" matTooltip="Print QR piece-mark labels — scan them with the mobile app">
                <mat-icon>qr_code_2</mat-icon>{{ bulkMode && selected.size > 0 ? 'Labels (' + selected.size + ')' : 'Labels' }}
              </button>
              @if (audit.project) {
                <a class="ghost" [routerLink]="['/projects', audit.project.id, 'orders', orderId, 'board']"><mat-icon>view_kanban</mat-icon>Board</a>
                <a class="ghost" [routerLink]="['/projects', audit.project.id, 'orders', orderId, 'quality']"><mat-icon>verified</mat-icon>Quality</a>
                <a class="ghost" [routerLink]="['/projects', audit.project.id, 'orders', orderId, 'shipping']"><mat-icon>local_shipping</mat-icon>Shipping</a>
              }
            </div>
          </div>
          <div class="meta">
            @if (audit.project) {
              <a class="m proj" [routerLink]="['/projects', audit.project.id]">
                <mat-icon>folder_open</mat-icon>{{ audit.project.name }}@if (audit.project.number) { <em>· {{ audit.project.number }}</em> }
              </a>
            }
            @if (audit.order.customerName) { <span class="m"><mat-icon>business</mat-icon>{{ audit.order.customerName }}</span> }
            <span class="m"><mat-icon>tag</mat-icon>Order qty {{ audit.order.quantity }}</span>
            @if (audit.order.dueDate) { <span class="m"><mat-icon>event</mat-icon>Due {{ audit.order.dueDate | date:'MMM d, y' }}</span> }
            <span class="m"><mat-icon>history</mat-icon>Created {{ audit.order.createdAt | date:'MMM d, y' }}</span>
          </div>
          <div class="kpis">
            <div class="kpi"><span class="kn">{{ audit.totals.itemsDone }}<em>/{{ audit.totals.items }}</em></span><span class="kl">Assemblies done</span></div>
            <div class="kpi wide">
              <span class="kn">{{ audit.totals.percent }}%</span>
              <span class="kbar"><span class="kfill" [style.width.%]="audit.totals.percent"></span></span>
              <span class="kl">Overall progress</span>
            </div>
            <div class="kpi"><span class="kn mono">{{ fmtDur(audit.totals.totalTimeSeconds) }}</span><span class="kl">Time logged</span></div>
            <div class="kpi" [class.good]="audit.totals.readyToShip > 0">
              <span class="kn">{{ audit.totals.readyToShip }}<em>&nbsp;ready</em></span>
              <span class="kl">{{ audit.totals.shippedItems }} shipped</span>
            </div>
            <div class="kpi" [class.alert]="audit.totals.openNcrs > 0"><span class="kn">{{ audit.totals.openNcrs }}</span><span class="kl">Open NCRs</span></div>
          </div>
        </header>

        <!-- ── Bulk bar ── -->
        @if (bulkMode) {
          <div class="bulkbar">
            <div class="brow">
              <span class="bsel"><mat-icon>checklist</mat-icon><b>{{ selected.size }}</b>&nbsp;selected</span>
              <button class="link" (click)="selectAllFiltered()">Select all {{ selectableFilteredCount }}</button>
              @if (selected.size > 0) { <button class="link" (click)="clearSelection()">Clear</button> }
              <span class="spacer"></span>
              <label class="bfield">Stage
                <select [(ngModel)]="bulkStageId">
                  <option value="" disabled>— pick a stage —</option>
                  @for (s of audit.stages; track s.id) { <option [value]="s.id">{{ s.name }}</option> }
                </select>
              </label>
              <label class="bfield">Action
                <select [(ngModel)]="bulkAction">
                  <option value="completed">Complete</option>
                  <option value="in_progress">Start (in progress)</option>
                  <option value="pending">Reset</option>
                  <option value="skipped">Skip</option>
                  <option value="qty">Set quantity…</option>
                </select>
              </label>
              @if (bulkAction === 'qty') { <label class="bfield">Qty<input type="number" min="0" [(ngModel)]="bulkQty"></label> }
              <button class="apply" [disabled]="bulkBusy || !bulkStageId || selected.size === 0" (click)="applyBulk()">
                @if (bulkBusy) { <mat-spinner diameter="14"></mat-spinner> } @else { <mat-icon>done_all</mat-icon> }
                <span>Apply to {{ selected.size }}</span>
              </button>
            </div>
            @if (bulkResult) {
              <div class="bres" [class.bad]="bulkResult.failed.length > 0">
                <mat-icon>{{ bulkResult.failed.length ? 'warning' : 'task_alt' }}</mat-icon>
                <span>Updated {{ bulkResult.updated }} of {{ bulkResult.requested }} assemblies.
                  @if (bulkResult.failed.length) {
                    Blocked:
                    @for (f of bulkResult.failed; track f.nodeId) { <b>{{ f.mark }}</b> <em>({{ f.message }})</em>&nbsp; }
                  }
                </span>
                <button class="dismiss" (click)="bulkResult = null">×</button>
              </div>
            }
          </div>
        }

        @if (error && audit) { <p class="err top"><mat-icon>block</mat-icon>{{ error }}<button class="dismiss" (click)="error = null">×</button></p> }

        <div class="grid">
          <!-- ── LEFT: assemblies ── -->
          <section class="card left">
            <div class="lhead">
              <div class="search">
                <mat-icon>search</mat-icon>
                <input type="text" placeholder="Search assemblies…" [ngModel]="query" (ngModelChange)="onQuery($event)">
                @if (query) { <button class="clear" (click)="onQuery('')">×</button> }
              </div>
            </div>
            <div class="chips">
              @for (f of statusFilters; track f.key) {
                <button class="fchip" [class.on]="statusFilter === f.key" (click)="setStatusFilter(f.key)">
                  {{ f.label }}<span class="fcount">{{ countFor(f.key) }}</span>
                </button>
              }
            </div>
            <div class="ltable" [class.bulk]="bulkMode">
              <div class="lthead">
                @if (bulkMode) {
                  <span class="cb"><input type="checkbox" [checked]="allFilteredSelected()" (change)="toggleAllFiltered($any($event.target).checked)" matTooltip="Select all filtered"></span>
                }
                <span>Assembly</span><span>Progress</span><span>Status</span>
              </div>
              <div class="lrows">
                @for (it of visible; track it.workOrderId) {
                  <div class="lrow" [class.sel]="it.workOrderId === selKey" (click)="select(it)">
                    @if (bulkMode) {
                      <span class="cb" (click)="$event.stopPropagation()">
                        <input type="checkbox" [disabled]="!it.nodeId" [checked]="selected.has(it.workOrderId)" (change)="toggleOne(it)">
                      </span>
                    }
                    <span class="lmark">
                      <span class="tag">{{ tagOf(it.nodeType) }}</span>
                      <span class="mk">{{ it.mark }}</span>
                      @if (it.openNcrs > 0) { <span class="ncr-dot" [matTooltip]="it.openNcrs + ' open NCR(s)'">{{ it.openNcrs }}</span> }
                      @if (it.shipStatus === 'ready') { <mat-icon class="ship-ico ready" [matTooltip]="'Ready to ship · ' + it.shipReadyQty + ' piece(s)'">local_shipping</mat-icon> }
                      @else if (it.shipStatus === 'shipped') { <mat-icon class="ship-ico shipped" matTooltip="Shipped">done_all</mat-icon> }
                      @else if (it.shipStatus === 'allocated') { <mat-icon class="ship-ico alloc" matTooltip="Allocated to a load">schedule_send</mat-icon> }
                    </span>
                    <span class="lprog">
                      <span class="pbar"><span class="pfill" [class.full]="it.percent >= 100" [style.width.%]="it.percent"></span></span>
                      <em>{{ it.percent }}%</em>
                    </span>
                    <span><span class="ss ss-{{ it.status }}">{{ itemStatusLabel(it.status) }}</span></span>
                  </div>
                } @empty {
                  <div class="none"><mat-icon>search_off</mat-icon><p>No assemblies match.</p></div>
                }
                @if (filtered.length > visible.length) {
                  <button class="more" (click)="showMore()">Show more ({{ filtered.length - visible.length }} hidden)</button>
                }
              </div>
            </div>
            <div class="lfoot">{{ filtered.length }} of {{ audit.items.length }} assemblies</div>
          </section>

          <!-- ── RIGHT: stage audit for the selected assembly ── -->
          <section class="card right">
            @if (!selItem) {
              <div class="none tall"><mat-icon>touch_app</mat-icon><p>Select an assembly on the left to see its full stage audit.</p></div>
            } @else {
              <div class="rhead">
                <div class="rtitle">
                  <h2>{{ selItem.mark }}</h2>
                  <span class="tag big">{{ tagOf(selItem.nodeType) }}</span>
                  <span class="ss ss-{{ selItem.status }}">{{ itemStatusLabel(selItem.status) }}</span>
                  @if (selItem.openNcrs > 0) { <span class="chip ncr"><mat-icon>report_problem</mat-icon>{{ selItem.openNcrs }} open NCR</span> }
                  <span class="chip ship sh-{{ selItem.shipStatus }}"><mat-icon>{{ shipIcon(selItem.shipStatus) }}</mat-icon>{{ shipLabel(selItem) }}</span>
                </div>
                <span class="wonum mono">{{ selItem.workOrderNumber }}</span>
              </div>

              <div class="props">
                @if (selItem.name && selItem.name !== selItem.mark) { <span class="prop"><label>Name</label>{{ selItem.name }}</span> }
                @if (selItem.profile) { <span class="prop"><label>Profile</label>{{ selItem.profile }}</span> }
                @if (selItem.materialGrade) { <span class="prop"><label>Grade</label>{{ selItem.materialGrade }}</span> }
                @if (selItem.lengthMm != null) { <span class="prop"><label>Length</label>{{ fmtLen(selItem.lengthMm) }}</span> }
                @if (selItem.weightKg != null) { <span class="prop"><label>Weight</label>{{ fmtKg(selItem.weightKg) }}</span> }
                <span class="prop"><label>Time logged</label><span class="mono">{{ fmtDur(selItem.totalTimeSeconds) }}</span></span>
                <span class="prop"><label>Last activity</label>{{ selItem.lastActivityAt ? (selItem.lastActivityAt | date:'MMM d, HH:mm') : '—' }}</span>
              </div>

              <!-- stage stepper -->
              <div class="stepper">
                @for (st of selItem.stages; track st.wosId; let i = $index; let last = $last) {
                  <button class="step s-{{ st.status }}" [class.cur]="st.stageId === selStageId" (click)="pickStage(st.stageId)">
                    <span class="dot">
                      @if (st.status === 'completed') { <mat-icon>check</mat-icon> }
                      @else if (st.status === 'skipped') { <mat-icon>skip_next</mat-icon> }
                      @else { {{ i + 1 }} }
                    </span>
                    <span class="sname">{{ st.name }}@if (st.gateBlocked) { <mat-icon class="gate-lock" [matTooltip]="st.gateReason || 'Quality gate: resolve NCRs / inspections before completing this stage'">lock</mat-icon> }</span>
                    <span class="scount mono">{{ st.qtyDone }}/{{ st.qtyTotal }}</span>
                  </button>
                  @if (!last) { <span class="conn" [class.done]="st.status === 'completed' || st.status === 'skipped'"></span> }
                }
              </div>

              <!-- selected stage detail + edit -->
              @if (selStage; as sg) {
                <div class="stage-card">
                  <div class="sg-head">
                    <h3>{{ sg.name }}</h3>
                    <span class="ss ss-{{ sg.status }}">{{ stageStatusLabel(sg.status) }}</span>
                    @if (sg.gateBlocked) { <span class="chip gate" [matTooltip]="sg.gateReason || ''"><mat-icon>lock</mat-icon>Quality gate</span> }
                    @if (savingIds.has(sg.wosId)) { <mat-spinner diameter="14"></mat-spinner> }
                    <span class="sg-qty mono">{{ sg.qtyDone }}<em>/{{ sg.qtyTotal }}</em></span>
                  </div>
                  <div class="sg-bar"><span class="sg-fill" [class.full]="sg.qtyTotal > 0 && sg.qtyDone >= sg.qtyTotal" [style.width.%]="sg.qtyTotal ? (sg.qtyDone / sg.qtyTotal) * 100 : 0"></span></div>
                  <div class="sg-ctl">
                    <button class="ctl" [disabled]="sg.status === 'skipped' || sg.qtyDone <= 0" (click)="dec(sg)">−</button>
                    <button class="ctl" [disabled]="sg.status === 'skipped' || sg.qtyDone >= sg.qtyTotal" (click)="inc(sg)">+</button>
                    <button class="ctl ok" [disabled]="sg.status === 'completed'" (click)="setStatus(sg, 'completed')">Complete all</button>
                    @if (sg.status === 'skipped') {
                      <button class="ctl" (click)="setStatus(sg, 'pending')">Unskip</button>
                    } @else {
                      <button class="ctl" [disabled]="sg.qtyDone === 0 && sg.status === 'pending'" (click)="setStatus(sg, 'pending')">Reset</button>
                      <button class="ctl warn" (click)="setStatus(sg, 'skipped')">Skip</button>
                    }
                  </div>
                  <div class="sg-meta">
                    <span><label>Started</label>{{ sg.startedAt ? (sg.startedAt | date:'MMM d, HH:mm') : '—' }}</span>
                    <span><label>Completed</label>{{ sg.completedAt ? (sg.completedAt | date:'MMM d, HH:mm') : '—' }}</span>
                    <span><label>Status updated</label>{{ sg.statusUpdatedAt ? (sg.statusUpdatedAt | date:'MMM d, HH:mm') : '—' }}</span>
                    <span><label>Assigned</label>{{ sg.assignedUser?.name || '—' }}</span>
                    <span><label>Station</label>{{ sg.station?.name || '—' }}</span>
                    <span><label>Stage time</label><span class="mono">{{ fmtDur(sg.timeSeconds) }}</span>@if (sg.timeEntries > 0) { <em>· {{ sg.timeEntries }} entr{{ sg.timeEntries === 1 ? 'y' : 'ies' }}</em> }</span>
                  </div>
                </div>
              }

              <!-- all stages at a glance -->
              <div class="audit-tbl">
                <div class="athead"><span>Stage</span><span>Status</span><span class="num">Done</span><span>Status updated</span><span>Assigned</span><span class="num">Time</span></div>
                @for (st of selItem.stages; track st.wosId) {
                  <button class="atrow" [class.cur]="st.stageId === selStageId" (click)="pickStage(st.stageId)">
                    <span class="at-name">{{ st.name }}</span>
                    <span class="st-cell"><span class="ss sm ss-{{ st.status }}">{{ stageStatusLabel(st.status) }}</span>@if (st.gateBlocked) { <mat-icon class="gate-lock" [matTooltip]="st.gateReason || 'Quality gate'">lock</mat-icon> }</span>
                    <span class="num mono">{{ st.qtyDone }}/{{ st.qtyTotal }}</span>
                    <span class="dt">{{ st.statusUpdatedAt ? (st.statusUpdatedAt | date:'MMM d, HH:mm') : '—' }}</span>
                    <span class="dt">{{ st.assignedUser?.name || '—' }}</span>
                    <span class="num mono">{{ fmtDur(st.timeSeconds) }}</span>
                  </button>
                }
              </div>

              <!-- audit trail: change history + time entries + NCRs -->
              <div class="trail">
                <div class="tr-head"><h3><mat-icon>fact_check</mat-icon>Change history</h3>@if (detailLoading) { <mat-spinner diameter="14"></mat-spinner> }</div>
                @if (!selItem.nodeId) {
                  <p class="none-line">No linked assembly node — no history available.</p>
                } @else if (detail && detail.events.length === 0 && !detailLoading) {
                  <p class="none-line">No stage changes recorded yet — history starts with the next update.</p>
                } @else if (detail) {
                  <div class="evlist">
                    @for (ev of detail.events; track ev.id) {
                      <div class="evrow">
                        <mat-icon class="ev-ico {{ evTone(ev) }}">{{ evIcon(ev) }}</mat-icon>
                        <div class="ev-body">
                          <span class="ev-main"><b>{{ ev.user || 'Unknown' }}</b> {{ evText(ev) }}</span>
                          <span class="ev-meta">{{ ev.stageName || 'Stage' }} · {{ ev.at | date:'MMM d, HH:mm:ss' }}</span>
                        </div>
                        @if (ev.action.startsWith('bulk')) { <span class="ev-src bulk">bulk</span> }
                        <span class="ev-src">{{ ev.source }}</span>
                      </div>
                    }
                  </div>
                }

                <div class="tr-head"><h3><mat-icon>history</mat-icon>Time entries</h3></div>
                @if (!selItem.nodeId) {
                  <p class="none-line">This row has no linked assembly node, so there is no trail to show.</p>
                } @else if (detail && detail.timeEntries.length === 0 && !detailLoading) {
                  <p class="none-line">No time has been clocked on this assembly yet.</p>
                } @else if (detail) {
                  <div class="tetable">
                    <div class="tehead"><span>Worker</span><span>Stage</span><span>Station</span><span>Start</span><span>End</span><span class="num">Duration</span></div>
                    @for (te of detail.timeEntries; track te.id) {
                      <div class="terow" [class.rework]="te.isRework">
                        <span>{{ te.user || '—' }}@if (te.isRework) { <em class="rw">rework</em> }</span>
                        <span>{{ te.stageName || '—' }}</span>
                        <span>{{ te.stationName || '—' }}</span>
                        <span class="dt">{{ te.startTime | date:'MMM d, HH:mm' }}</span>
                        <span class="dt" [class.live]="!te.endTime">{{ te.endTime ? (te.endTime | date:'MMM d, HH:mm') : 'active' }}</span>
                        <span class="num mono">{{ te.durationSeconds != null ? fmtDur(te.durationSeconds) : '—' }}</span>
                      </div>
                    }
                  </div>
                }

                <div class="tr-head"><h3><mat-icon>report_problem</mat-icon>NCRs</h3></div>
                @if (selItem.nodeId && detail && detail.ncrs.length === 0) {
                  <p class="none-line">No NCRs raised against this assembly.</p>
                } @else if (detail) {
                  @for (n of detail.ncrs; track n.id) {
                    <a class="ncr-row" routerLink="/ncr">
                      <b class="mono">{{ n.number }}</b>
                      <span class="ncr-title">{{ n.title }}</span>
                      <span class="sev sev-{{ n.severity }}">{{ n.severity }}</span>
                      <span class="nst nst-{{ n.status }}">{{ n.status }}</span>
                      <span class="dt">{{ n.createdAt | date:'MMM d' }}</span>
                    </a>
                  }
                }
              </div>
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 1500px; margin: 0 auto; }
    .center { display: flex; justify-content: center; padding: 64px 0; }
    .mono { font-family: 'Space Grotesk', monospace; }
    .back { display: inline-flex; align-items: center; gap: 4px; color: var(--clay-text-muted); font-size: 13px; font-weight: 500; margin-bottom: 10px; text-decoration: none; }
    .back:hover { color: var(--clay-primary); }
    .back mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 64px 0; color: var(--clay-text-muted); }
    .empty-state mat-icon { font-size: 42px; width: 42px; height: 42px; opacity: .5; }

    /* Header */
    .head { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 14px 18px; box-shadow: var(--clay-shadow-soft); margin-bottom: 12px; }
    .hrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .t-ico { color: var(--clay-primary); }
    .title h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: var(--clay-text); }
    .order-switch { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); background: var(--clay-surface); color: var(--clay-text); font-size: 15px; font-weight: 700; font-family: inherit; padding: 6px 10px; max-width: 360px; cursor: pointer; }
    .pill { padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .st-planned { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .st-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .st-completed { background: var(--success-bg); color: var(--success-text); }
    .st-cancelled { background: var(--danger-bg); color: var(--danger-text); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .actions .ghost { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); border-radius: var(--clay-radius-sm); padding: 7px 12px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; font-family: inherit; }
    .actions .ghost:hover { border-color: var(--clay-primary); color: var(--clay-primary); }
    .actions .ghost.on { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
    .actions mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .meta { display: flex; gap: 6px 16px; flex-wrap: wrap; margin-top: 8px; }
    .m { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--clay-text-secondary); text-decoration: none; }
    .m mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--clay-text-muted); }
    .m em { font-style: normal; color: var(--clay-text-muted); }
    .m.proj:hover { color: var(--clay-primary); }
    .kpis { display: grid; grid-template-columns: auto 1fr auto auto auto; gap: 10px; margin-top: 12px; }
    .kpi { display: flex; flex-direction: column; gap: 3px; background: var(--clay-bg-warm); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 9px 14px; min-width: 120px; }
    .kpi.alert { border-color: var(--danger); }
    .kpi.good { border-color: var(--success); }
    .kn { font-size: 17px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; line-height: 1.1; }
    .kn em { font-style: normal; font-size: 12px; color: var(--clay-text-muted); font-weight: 500; }
    .kn b { font-size: 12px; color: var(--clay-primary); margin-left: 6px; }
    .kl { font-size: 11px; color: var(--clay-text-muted); }
    .kbar { display: block; height: 6px; border-radius: 4px; background: var(--clay-surface); overflow: hidden; }
    .kfill { display: block; height: 100%; background: linear-gradient(90deg, var(--clay-primary), var(--clay-primary-light)); border-radius: 4px; transition: width .4s ease; }

    /* Bulk bar */
    .bulkbar { background: var(--clay-surface); border: 1px solid var(--clay-primary); border-radius: var(--clay-radius); padding: 10px 14px; margin-bottom: 12px; box-shadow: var(--clay-shadow-soft); }
    .brow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .bsel { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--clay-text); }
    .bsel mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--clay-primary); }
    .link { background: none; border: none; color: var(--clay-primary); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; padding: 0; }
    .spacer { flex: 1; }
    .bfield { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); }
    .bfield select, .bfield input { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); padding: 6px 8px; font-size: 13px; font-family: inherit; }
    .bfield input { width: 76px; }
    .apply { display: inline-flex; align-items: center; gap: 6px; background: var(--clay-primary); color: #fff; border: none; border-radius: var(--clay-radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .apply:disabled { opacity: .5; cursor: default; }
    .apply mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .bres { display: flex; align-items: flex-start; gap: 8px; margin-top: 9px; background: var(--success-bg); color: var(--success-text); border-radius: var(--clay-radius-sm); padding: 8px 11px; font-size: 12.5px; }
    .bres.bad { background: var(--warning-bg); color: var(--warning-text); }
    .bres mat-icon { font-size: 17px; width: 17px; height: 17px; flex-shrink: 0; margin-top: 1px; }
    .bres em { font-style: normal; opacity: .85; }
    .dismiss { margin-left: auto; background: none; border: none; color: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }

    .err { display: flex; align-items: center; gap: 6px; background: var(--danger-bg); color: var(--danger-text); border-radius: var(--clay-radius-sm); padding: 9px 12px; font-size: 13px; margin: 0 0 12px; }
    .err mat-icon { font-size: 17px; width: 17px; height: 17px; }

    /* Layout */
    .grid { display: grid; grid-template-columns: 390px minmax(0, 1fr); gap: 12px; align-items: start; }
    .card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); box-shadow: var(--clay-shadow-soft); }

    /* Left: assemblies */
    .left { display: flex; flex-direction: column; position: sticky; top: 12px; }
    .lhead { padding: 12px 12px 0; }
    .search { display: flex; align-items: center; gap: 5px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 6px 9px; }
    .search mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); }
    .search input { border: none; outline: none; background: transparent; font-size: 13px; color: var(--clay-text); font-family: inherit; flex: 1; min-width: 0; }
    .search .clear { background: none; border: none; color: var(--clay-text-muted); cursor: pointer; font-size: 15px; font-weight: 700; padding: 0 2px; }
    .chips { display: flex; gap: 5px; flex-wrap: wrap; padding: 9px 12px; }
    .fchip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); border-radius: 999px; padding: 3px 10px; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .fchip.on { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
    .fcount { background: var(--clay-bg-warm); color: var(--clay-text-secondary); border-radius: 999px; padding: 0 6px; font-size: 10px; }
    .fchip.on .fcount { background: rgba(255,255,255,.25); color: #fff; }

    .lthead, .lrow { display: grid; grid-template-columns: minmax(0, 1fr) 92px 88px; gap: 8px; align-items: center; padding: 8px 12px; }
    .ltable.bulk .lthead, .ltable.bulk .lrow { grid-template-columns: 24px minmax(0, 1fr) 92px 88px; }
    .lthead { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); border-top: 1px solid var(--clay-border); border-bottom: 1px solid var(--clay-border); background: var(--clay-bg-warm); }
    .lrows { max-height: 62vh; overflow-y: auto; }
    .lrow { border-bottom: 1px solid var(--clay-border); cursor: pointer; transition: background .12s; }
    .lrow:hover { background: var(--clay-surface-hover); }
    .lrow.sel { background: var(--info-bg); box-shadow: inset 3px 0 0 var(--clay-primary); }
    .cb { display: flex; align-items: center; }
    .cb input { accent-color: var(--clay-primary); cursor: pointer; }
    .lmark { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .mk { font-size: 13px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tag { font-size: 9px; font-weight: 800; color: var(--clay-primary); background: var(--info-bg); border-radius: 4px; padding: 1px 4px; flex-shrink: 0; }
    .tag.big { font-size: 10px; padding: 2px 6px; }
    .ncr-dot { background: var(--danger-bg); color: var(--danger-text); border-radius: 999px; padding: 0 6px; font-size: 10px; font-weight: 800; flex-shrink: 0; }
    .ship-ico { font-size: 15px; width: 15px; height: 15px; flex-shrink: 0; }
    .ship-ico.ready { color: var(--success); }
    .ship-ico.shipped { color: var(--clay-text-muted); }
    .ship-ico.alloc { color: var(--clay-primary); }
    .num { font-size: 12.5px; color: var(--clay-text); text-align: right; font-family: 'Space Grotesk', monospace; }
    .lprog { display: flex; align-items: center; gap: 6px; }
    .pbar { flex: 1; height: 7px; border-radius: 5px; background: var(--clay-bg-warm); overflow: hidden; }
    .pfill { display: block; height: 100%; background: linear-gradient(90deg, var(--clay-primary), var(--clay-primary-light)); border-radius: 5px; transition: width .3s ease; }
    .pfill.full { background: var(--success); }
    .lprog em { font-style: normal; font-size: 11px; font-weight: 700; color: var(--clay-text-secondary); min-width: 32px; text-align: right; }
    .ss { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; white-space: nowrap; }
    .ss.sm { font-size: 10.5px; padding: 1px 7px; }
    .ss-not_started, .ss-pending { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .ss-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .ss-completed { background: var(--success-bg); color: var(--success-text); }
    .ss-skipped { background: var(--clay-bg-warm); color: var(--clay-text-muted); }
    .more { width: 100%; background: var(--clay-surface); border: 1px dashed var(--clay-border); border-radius: var(--clay-radius-sm); padding: 8px; font-size: 12px; font-weight: 600; color: var(--clay-primary); cursor: pointer; font-family: inherit; margin: 8px 0; }
    .more:hover { border-color: var(--clay-primary); }
    .lfoot { padding: 8px 12px; font-size: 11.5px; color: var(--clay-text-muted); border-top: 1px solid var(--clay-border); }
    .none { display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--clay-text-muted); font-size: 13px; padding: 28px 0; }
    .none mat-icon { font-size: 30px; width: 30px; height: 30px; opacity: .5; }
    .none.tall { padding: 110px 0; }

    /* Right: audit pane */
    .right { padding: 16px 18px; min-height: 420px; }
    .rhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .rtitle { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
    .rtitle h2 { margin: 0; font-size: 19px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; }
    .chip { display: inline-flex; align-items: center; gap: 3px; border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 700; }
    .chip mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .chip.ncr { background: var(--danger-bg); color: var(--danger-text); }
    .chip.ship.sh-ready { background: var(--success-bg); color: var(--success-text); }
    .chip.ship.sh-shipped { background: var(--clay-bg-warm); color: var(--clay-text-secondary); }
    .chip.ship.sh-allocated { background: var(--info-bg); color: var(--clay-primary); }
    .chip.ship.sh-blocked_ncr { background: var(--danger-bg); color: var(--danger-text); }
    .chip.ship.sh-in_production { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .chip.gate { background: var(--warning-bg); color: var(--warning-text); }
    .gate-lock { font-size: 13px; width: 13px; height: 13px; color: var(--warning-text); vertical-align: middle; margin-left: 3px; }
    .st-cell { display: inline-flex; align-items: center; gap: 4px; }
    .wonum { font-size: 12px; color: var(--clay-text-muted); font-weight: 600; }
    .props { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 14px; }
    .prop { display: inline-flex; flex-direction: column; gap: 1px; background: var(--clay-bg-warm); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 6px 11px; font-size: 12.5px; color: var(--clay-text); font-weight: 600; }
    .prop label { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--clay-text-muted); }

    /* Stepper */
    .stepper { display: flex; align-items: flex-start; gap: 2px; overflow-x: auto; padding: 6px 2px 10px; }
    .step { display: flex; flex-direction: column; align-items: center; gap: 4px; background: none; border: none; cursor: pointer; font-family: inherit; padding: 6px 8px; border-radius: var(--clay-radius-sm); min-width: 86px; }
    .step:hover { background: var(--clay-surface-hover); }
    .step.cur { background: var(--info-bg); }
    .dot { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; border: 2px solid var(--clay-border); color: var(--clay-text-muted); background: var(--clay-surface); }
    .dot mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .step.s-completed .dot { background: var(--success); border-color: var(--success); color: #fff; }
    .step.s-in_progress .dot { border-color: var(--clay-primary); color: var(--clay-primary); }
    .step.s-skipped .dot { background: var(--clay-bg-warm); color: var(--clay-text-muted); }
    .step.cur .dot { box-shadow: 0 0 0 3px var(--info-bg); }
    .sname { font-size: 11px; font-weight: 700; color: var(--clay-text-secondary); text-align: center; line-height: 1.25; max-width: 110px; }
    .step.cur .sname { color: var(--clay-primary); }
    .scount { font-size: 10.5px; color: var(--clay-text-muted); }
    .conn { flex: 1; min-width: 14px; height: 2px; background: var(--clay-border); margin-top: 21px; border-radius: 2px; }
    .conn.done { background: var(--success); }

    /* Stage detail card */
    .stage-card { border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 13px 15px; margin-bottom: 14px; background: var(--clay-bg-warm); }
    .sg-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .sg-head h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--clay-text); }
    .sg-qty { margin-left: auto; font-size: 17px; font-weight: 700; color: var(--clay-text); }
    .sg-qty em { font-style: normal; font-size: 12px; color: var(--clay-text-muted); }
    .sg-bar { height: 9px; border-radius: 5px; background: var(--clay-surface); overflow: hidden; margin: 9px 0 11px; border: 1px solid var(--clay-border); }
    .sg-fill { display: block; height: 100%; background: linear-gradient(90deg, var(--clay-primary), var(--clay-primary-light)); border-radius: 5px; transition: width .25s ease; }
    .sg-fill.full { background: var(--success); }
    .sg-ctl { display: flex; gap: 6px; flex-wrap: wrap; }
    .ctl { border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text); border-radius: var(--clay-radius-xs); padding: 6px 13px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; min-width: 38px; }
    .ctl:hover:not(:disabled) { border-color: var(--clay-primary); }
    .ctl:disabled { opacity: .4; cursor: default; }
    .ctl.ok { color: var(--success-text); border-color: var(--success-text); }
    .ctl.warn { color: var(--warning-text); }
    .sg-meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px 14px; margin-top: 12px; }
    .sg-meta span { display: flex; flex-direction: column; gap: 1px; font-size: 12.5px; color: var(--clay-text); font-weight: 600; }
    .sg-meta label { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--clay-text-muted); }
    .sg-meta em { font-style: normal; font-size: 11px; color: var(--clay-text-muted); font-weight: 500; }

    /* All-stage table */
    .audit-tbl { border: 1px solid var(--clay-border); border-radius: var(--clay-radius); overflow: hidden; margin-bottom: 16px; }
    .athead, .atrow { display: grid; grid-template-columns: minmax(0, 1.2fr) 108px 76px 130px minmax(0, 1fr) 90px; gap: 8px; align-items: center; padding: 8px 12px; }
    .athead { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); background: var(--clay-bg-warm); border-bottom: 1px solid var(--clay-border); }
    .atrow { width: 100%; background: var(--clay-surface); border: none; border-bottom: 1px solid var(--clay-border); cursor: pointer; font-family: inherit; text-align: left; transition: background .12s; }
    .atrow:last-child { border-bottom: none; }
    .atrow:hover { background: var(--clay-surface-hover); }
    .atrow.cur { background: var(--info-bg); box-shadow: inset 3px 0 0 var(--clay-primary); }
    .at-name { font-size: 13px; font-weight: 700; color: var(--clay-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dt { font-size: 12px; color: var(--clay-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dt.live { color: var(--success-text); font-weight: 700; }

    /* Change history */
    .evlist { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); overflow: hidden; }
    .evrow { display: flex; align-items: center; gap: 10px; padding: 8px 11px; border-bottom: 1px solid var(--clay-border); background: var(--clay-surface); }
    .evrow:last-child { border-bottom: none; }
    .ev-ico { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .ev-ico.good { color: var(--success); }
    .ev-ico.mute { color: var(--clay-text-muted); }
    .ev-ico.info { color: var(--clay-primary); }
    .ev-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .ev-main { font-size: 12.5px; color: var(--clay-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ev-main b { font-weight: 700; }
    .ev-meta { font-size: 11px; color: var(--clay-text-muted); }
    .ev-src { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: var(--clay-text-muted); background: var(--clay-bg-warm); border-radius: 4px; padding: 2px 6px; flex-shrink: 0; }
    .ev-src.bulk { color: var(--clay-primary); background: var(--info-bg); }

    /* Trail */
    .tr-head { display: flex; align-items: center; gap: 8px; margin: 14px 0 8px; }
    .tr-head h3 { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13.5px; font-weight: 700; color: var(--clay-text); }
    .tr-head mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); }
    .none-line { font-size: 12.5px; color: var(--clay-text-muted); margin: 4px 0 10px; }
    .tetable { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); overflow: hidden; }
    .tehead, .terow { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, .9fr) 110px 110px 86px; gap: 8px; align-items: center; padding: 7px 11px; font-size: 12.5px; }
    .tehead { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); background: var(--clay-bg-warm); border-bottom: 1px solid var(--clay-border); }
    .terow { border-bottom: 1px solid var(--clay-border); color: var(--clay-text); }
    .terow:last-child { border-bottom: none; }
    .terow.rework { background: var(--warning-bg); }
    .rw { font-style: normal; font-size: 10px; font-weight: 800; color: var(--warning-text); margin-left: 5px; text-transform: uppercase; }
    .ncr-row { display: flex; align-items: center; gap: 10px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 8px 11px; margin-bottom: 6px; text-decoration: none; font-size: 12.5px; color: var(--clay-text); transition: border-color .15s; }
    .ncr-row:hover { border-color: var(--clay-primary); }
    .ncr-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--clay-text-secondary); }
    .sev { font-size: 10px; font-weight: 800; text-transform: uppercase; border-radius: 999px; padding: 1px 7px; }
    .sev-low { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .sev-medium { background: var(--warning-bg); color: var(--warning-text); }
    .sev-high, .sev-critical { background: var(--danger-bg); color: var(--danger-text); }
    .nst { font-size: 10.5px; font-weight: 700; border-radius: 999px; padding: 1px 8px; background: var(--clay-bg-warm); color: var(--clay-text-secondary); text-transform: capitalize; }
    .nst-open, .nst-in_progress { background: var(--danger-bg); color: var(--danger-text); }
    .nst-closed { background: var(--success-bg); color: var(--success-text); }

    @media (max-width: 1100px) {
      .grid { grid-template-columns: 1fr; }
      .left { position: static; }
      .lrows { max-height: 44vh; }
      .kpis { grid-template-columns: 1fr 1fr; }
      .athead, .atrow { grid-template-columns: minmax(0, 1fr) 100px 64px 86px; }
      .athead span:nth-child(5), .atrow span:nth-child(5), .athead span:nth-child(4), .atrow span:nth-child(4) { display: none; }
      .tehead, .terow { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 100px 80px; }
      .tehead span:nth-child(3), .terow span:nth-child(3), .tehead span:nth-child(5), .terow span:nth-child(5) { display: none; }
    }
  `],
})
export class WorkOrderAuditComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private svc = inject(ProjectsService);

  orderId = '';
  audit: OrderAudit | null = null;
  loading = true;
  error: string | null = null;

  /** Order switcher (jump between work orders without leaving the dashboard). */
  allOrders: { id: string; number: string; projectName: string }[] = [];

  // Left panel state
  query = '';
  statusFilter: StatusFilter = 'all';
  filtered: AuditItem[] = [];
  visible: AuditItem[] = [];
  private visibleLimit = PAGE;

  readonly statusFilters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'not_started', label: 'Not started' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'completed', label: 'Completed' },
    { key: 'holds', label: 'NCR' },
  ];

  // Selection (assembly + stage)
  selKey: string | null = null; // workOrderId of the selected row
  selStageId: string | null = null;
  selItem: AuditItem | null = null;
  selStage: AuditStageRow | null = null;

  // Lazy per-assembly trail
  detail: NodeAuditDetail | null = null;
  detailLoading = false;

  // Inline stage editing
  savingIds = new Set<string>();
  private sendTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Bulk edit
  bulkMode = false;
  selected = new Set<string>(); // workOrderIds (mapped to nodeIds on apply)
  bulkStageId = '';
  bulkAction: BulkAction = 'completed';
  bulkQty = 0;
  bulkBusy = false;
  bulkResult: BulkStageResult | null = null;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private routeSub: Subscription | null = null;
  private realtime = inject(RealtimeService);
  private rtSub: Subscription | null = null;
  private rtDebounce: ReturnType<typeof setTimeout> | null = null;

  get selectableFilteredCount(): number { return this.filtered.filter((i) => !!i.nodeId).length; }

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe((pm) => {
      const id = pm.get('id') ?? '';
      if (id && id !== this.orderId) {
        this.orderId = id;
        this.resetForOrder();
        this.load();
      }
    });
    this.svc.ordersDashboard().subscribe({
      next: (d) => (this.allOrders = d.orders.map((o) => ({ id: o.id, number: o.number, projectName: o.project.name }))),
      error: () => {},
    });
    // LIVE: refresh when anyone (web or mobile) moves a stage of this order.
    this.rtSub = this.realtime.on<any>('work-order-update').subscribe((p) => {
      if (p?.productionOrderId && p.productionOrderId !== this.orderId) return;
      if (this.rtDebounce) clearTimeout(this.rtDebounce);
      this.rtDebounce = setTimeout(() => {
        if (!this.loading && !this.bulkBusy && this.sendTimers.size === 0 && this.savingIds.size === 0) this.silentReload();
      }, 350);
    });
    // Slow polling stays as the fallback when the socket can't connect.
    this.pollTimer = setInterval(() => {
      if (document.hidden || this.loading || this.bulkBusy || this.sendTimers.size > 0 || this.savingIds.size > 0) return;
      this.silentReload();
    }, 60000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.rtDebounce) clearTimeout(this.rtDebounce);
    this.rtSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    for (const wosId of [...this.sendTimers.keys()]) this.flush(wosId); // no taps lost on navigation
  }

  private resetForOrder(): void {
    this.audit = null;
    this.selKey = null;
    this.selStageId = null;
    this.selItem = null;
    this.selStage = null;
    this.detail = null;
    this.query = '';
    this.statusFilter = 'all';
    this.visibleLimit = PAGE;
    this.selected.clear();
    this.bulkResult = null;
    this.error = null;
  }

  load(): void {
    this.loading = true;
    this.svc.orderAudit(this.orderId).subscribe({
      next: (a) => {
        this.audit = a;
        this.loading = false;
        this.restoreSelection();
        this.recompute();
        this.loadDetail();
      },
      error: (e) => { this.audit = null; this.error = e?.error?.message || null; this.loading = false; },
    });
  }

  /** Background reload that keeps selection, filters and scroll context. */
  private silentReload(): void {
    this.svc.orderAudit(this.orderId).subscribe({
      next: (a) => {
        if (this.sendTimers.size > 0 || this.savingIds.size > 0) return; // edits in flight — keep local truth
        this.audit = a;
        this.recompute();
        this.refreshDetailQuiet();
      },
      error: () => { /* keep last good state */ },
    });
  }

  /** Pick the row/stage from the URL (?node= & ?stage=) or default to the first row. */
  private restoreSelection(): void {
    const items = this.audit?.items ?? [];
    const qp = this.route.snapshot.queryParamMap;
    const nodeParam = qp.get('node');
    const stageParam = qp.get('stage');
    const byParam = nodeParam ? items.find((i) => i.nodeId === nodeParam || i.workOrderId === nodeParam) : undefined;
    const target = byParam ?? (this.selKey ? items.find((i) => i.workOrderId === this.selKey) : undefined) ?? items[0];
    this.selKey = target?.workOrderId ?? null;
    if (target) {
      const stages = target.stages;
      const wanted = stageParam ? stages.find((s) => s.stageId === stageParam) : undefined;
      this.selStageId = (wanted ?? stages.find((s) => s.status === 'pending' || s.status === 'in_progress') ?? stages[0])?.stageId ?? null;
    }
  }

  /** Rebuild every derived view-model (no method calls in hot template paths). */
  private recompute(): void {
    const items = this.audit?.items ?? [];
    const term = this.query.trim().toLowerCase();
    let rows = items;
    switch (this.statusFilter) {
      case 'not_started': rows = rows.filter((i) => i.status === 'not_started'); break;
      case 'in_progress': rows = rows.filter((i) => i.status === 'in_progress'); break;
      case 'completed': rows = rows.filter((i) => i.status === 'completed'); break;
      case 'holds': rows = rows.filter((i) => i.openNcrs > 0); break;
    }
    if (term) {
      rows = rows.filter((i) =>
        i.mark.toLowerCase().includes(term)
        || (i.name ?? '').toLowerCase().includes(term)
        || i.workOrderNumber.toLowerCase().includes(term));
    }
    this.filtered = rows;
    this.visible = rows.slice(0, this.visibleLimit);

    this.selItem = this.selKey ? items.find((i) => i.workOrderId === this.selKey) ?? null : null;
    if (this.selItem) {
      this.selStage = this.selItem.stages.find((s) => s.stageId === this.selStageId) ?? this.selItem.stages[0] ?? null;
      this.selStageId = this.selStage?.stageId ?? null;
    } else {
      this.selStage = null;
    }
  }

  // ── Left panel interactions ──
  onQuery(v: string): void { this.query = v; this.visibleLimit = PAGE; this.recompute(); }
  setStatusFilter(f: StatusFilter): void { this.statusFilter = this.statusFilter === f ? 'all' : f; this.visibleLimit = PAGE; this.recompute(); }
  showMore(): void { this.visibleLimit += PAGE; this.recompute(); }

  countFor(f: StatusFilter): number {
    const items = this.audit?.items ?? [];
    switch (f) {
      case 'all': return items.length;
      case 'not_started': return items.filter((i) => i.status === 'not_started').length;
      case 'in_progress': return items.filter((i) => i.status === 'in_progress').length;
      case 'completed': return items.filter((i) => i.status === 'completed').length;
      case 'holds': return items.filter((i) => i.openNcrs > 0).length;
    }
  }

  select(it: AuditItem): void {
    if (this.selKey === it.workOrderId) return;
    this.selKey = it.workOrderId;
    this.selStageId = (it.stages.find((s) => s.status === 'pending' || s.status === 'in_progress') ?? it.stages[0])?.stageId ?? null;
    this.detail = null;
    this.recompute();
    this.loadDetail();
    this.syncUrl();
  }

  pickStage(stageId: string): void {
    this.selStageId = stageId;
    this.recompute();
    this.syncUrl();
  }

  /** Keep the selection shareable/refresh-proof without polluting history. */
  private syncUrl(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { node: this.selItem?.nodeId ?? this.selItem?.workOrderId ?? null, stage: this.selStageId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ── Per-assembly trail ──
  private loadDetail(): void {
    const nodeId = this.selItem?.nodeId;
    if (!nodeId) { this.detail = null; return; }
    this.detailLoading = true;
    this.svc.orderNodeAudit(this.orderId, nodeId).subscribe({
      next: (d) => { if (d.nodeId === this.selItem?.nodeId) { this.detail = d; } this.detailLoading = false; },
      error: () => { this.detailLoading = false; },
    });
  }
  private refreshDetailQuiet(): void {
    const nodeId = this.selItem?.nodeId;
    if (!nodeId) return;
    this.svc.orderNodeAudit(this.orderId, nodeId).subscribe({
      next: (d) => { if (d.nodeId === this.selItem?.nodeId) this.detail = d; },
      error: () => {},
    });
  }

  // ── Inline stage editing (optimistic stepper + debounced absolute send) ──
  inc(sg: AuditStageRow): void { this.bump(sg, +1); }
  dec(sg: AuditStageRow): void { this.bump(sg, -1); }

  private bump(sg: AuditStageRow, delta: number): void {
    const next = Math.max(0, Math.min(sg.qtyTotal, sg.qtyDone + delta));
    if (next === sg.qtyDone || sg.status === 'skipped') return;
    sg.qtyDone = next;
    sg.status = sg.qtyTotal > 0 && next >= sg.qtyTotal ? 'completed' : next > 0 ? 'in_progress' : 'pending';
    this.recomputeItemLocal();
    const existing = this.sendTimers.get(sg.wosId);
    if (existing) clearTimeout(existing);
    this.sendTimers.set(sg.wosId, setTimeout(() => this.flush(sg.wosId), 600));
  }

  private flush(wosId: string): void {
    const t = this.sendTimers.get(wosId);
    if (t) { clearTimeout(t); this.sendTimers.delete(wosId); }
    const row = this.findRow(wosId);
    if (!row) return;
    this.savingIds.add(wosId);
    this.svc.setOrderStage(this.orderId, wosId, { qtyDone: row.qtyDone }).subscribe({
      next: () => { this.savingIds.delete(wosId); this.afterEdit(); },
      error: (e) => {
        this.savingIds.delete(wosId);
        this.error = e?.error?.message || 'Could not update the stage.';
        this.silentReload(); // resync to server truth
      },
    });
  }

  setStatus(sg: AuditStageRow, status: 'completed' | 'pending' | 'in_progress' | 'skipped'): void {
    const prev = { qtyDone: sg.qtyDone, status: sg.status };
    if (status === 'completed') sg.qtyDone = sg.qtyTotal;
    if (status === 'pending') sg.qtyDone = 0;
    sg.status = status;
    this.recomputeItemLocal();
    this.savingIds.add(sg.wosId);
    this.svc.setOrderStage(this.orderId, sg.wosId, { status }).subscribe({
      next: () => { this.savingIds.delete(sg.wosId); this.afterEdit(); },
      error: (e) => {
        this.savingIds.delete(sg.wosId);
        sg.qtyDone = prev.qtyDone;
        sg.status = prev.status;
        this.recomputeItemLocal();
        this.error = e?.error?.message || 'Could not update the stage.';
      },
    });
  }

  /** After a server-confirmed edit, pull fresh truth once nothing else is pending. */
  private afterEdit(): void {
    if (this.sendTimers.size === 0 && this.savingIds.size === 0) this.silentReload();
  }

  private findRow(wosId: string): AuditStageRow | null {
    for (const it of this.audit?.items ?? []) {
      const r = it.stages.find((s) => s.wosId === wosId);
      if (r) return r;
    }
    return null;
  }

  /** Local roll-up of the selected item so the left list + KPIs track the stepper instantly. */
  private recomputeItemLocal(): void {
    const it = this.selItem;
    if (it) {
      const active = it.stages.filter((s) => s.status !== 'skipped');
      it.unitsTotal = active.reduce((a, s) => a + s.qtyTotal, 0);
      it.unitsDone = active.reduce((a, s) => a + Math.min(s.qtyDone, s.qtyTotal), 0);
      it.percent = it.unitsTotal > 0 ? Math.round((it.unitsDone / it.unitsTotal) * 1000) / 10 : 0;
      it.status = it.unitsTotal > 0 && it.unitsDone >= it.unitsTotal ? 'completed' : it.unitsDone > 0 ? 'in_progress' : 'not_started';
    }
    if (this.audit) {
      const t = this.audit.totals;
      t.unitsDone = this.audit.items.reduce((a, i) => a + i.unitsDone, 0);
      t.unitsTotal = this.audit.items.reduce((a, i) => a + i.unitsTotal, 0);
      t.percent = t.unitsTotal > 0 ? Math.round((t.unitsDone / t.unitsTotal) * 1000) / 10 : 0;
      t.itemsDone = this.audit.items.filter((i) => i.status === 'completed').length;
    }
    this.recompute();
  }

  // ── Bulk edit ──
  toggleBulk(): void {
    this.bulkMode = !this.bulkMode;
    if (!this.bulkMode) { this.selected.clear(); this.bulkResult = null; }
    else if (!this.bulkStageId) this.bulkStageId = this.selStageId ?? this.audit?.stages[0]?.id ?? '';
  }

  toggleOne(it: AuditItem): void {
    if (!it.nodeId) return;
    if (this.selected.has(it.workOrderId)) this.selected.delete(it.workOrderId);
    else this.selected.add(it.workOrderId);
  }

  allFilteredSelected(): boolean {
    const sel = this.filtered.filter((i) => !!i.nodeId);
    return sel.length > 0 && sel.every((i) => this.selected.has(i.workOrderId));
  }

  toggleAllFiltered(checked: boolean): void {
    for (const it of this.filtered) {
      if (!it.nodeId) continue;
      if (checked) this.selected.add(it.workOrderId);
      else this.selected.delete(it.workOrderId);
    }
  }

  selectAllFiltered(): void { this.toggleAllFiltered(true); }
  clearSelection(): void { this.selected.clear(); }

  applyBulk(): void {
    if (!this.audit || !this.bulkStageId || this.selected.size === 0 || this.bulkBusy) return;
    const byWoId = new Map(this.audit.items.map((i) => [i.workOrderId, i]));
    const nodeIds = [...this.selected].map((k) => byWoId.get(k)?.nodeId).filter((x): x is string => !!x);
    if (!nodeIds.length) return;
    const body = this.bulkAction === 'qty'
      ? { stageId: this.bulkStageId, nodeIds, qtyDone: Math.max(0, Number(this.bulkQty) || 0) }
      : { stageId: this.bulkStageId, nodeIds, status: this.bulkAction };
    this.bulkBusy = true;
    this.bulkResult = null;
    this.svc.bulkUpdateOrderStage(this.orderId, body).subscribe({
      next: (res) => { this.bulkBusy = false; this.bulkResult = res; this.silentReload(); },
      error: (e) => { this.bulkBusy = false; this.error = e?.error?.message || 'Bulk update failed.'; },
    });
  }

  // ── QR piece-mark labels (scanned by the mobile app) ──
  labelsBusy = false;

  async printLabels(): Promise<void> {
    if (!this.audit || this.labelsBusy) return;
    const pool = this.bulkMode && this.selected.size > 0
      ? this.audit.items.filter((i) => this.selected.has(i.workOrderId))
      : this.filtered;
    const items = pool.filter((i) => !!i.nodeId).slice(0, 400);
    if (!items.length) { this.error = 'No assemblies to label.'; return; }
    this.labelsBusy = true;
    try {
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const projectId = this.audit.project?.id ?? '';
      const cards = await Promise.all(items.map(async (it) => {
        const png = await QRCode.toDataURL(JSON.stringify({ t: 'pcs-asm', p: projectId, n: it.nodeId }), { width: 220, margin: 1 });
        const spec = [it.profile, it.materialGrade].filter(Boolean).join(' · ');
        return `<div class="label">
          <img src="${png}" alt="QR">
          <div class="lb">
            <div class="mk">${esc(it.mark)}</div>
            ${spec ? `<div class="ln">${esc(spec)}</div>` : ''}
            <div class="ln">${esc(it.workOrderNumber)} · ${esc(this.audit!.order.number)}</div>
            <div class="ln">${esc(this.audit!.project?.name ?? '')}</div>
          </div>
        </div>`;
      }));
      const html = `<!doctype html><html><head><title>Labels — ${esc(this.audit.order.number)}</title><style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 8mm; display: flex; flex-wrap: wrap; gap: 5mm; }
        .label { display: flex; align-items: center; gap: 4mm; border: 1px solid #555; border-radius: 2.5mm; padding: 3mm; width: 88mm; height: 34mm; box-sizing: border-box; page-break-inside: avoid; overflow: hidden; }
        img { width: 27mm; height: 27mm; flex-shrink: 0; }
        .lb { min-width: 0; }
        .mk { font-size: 7.5mm; font-weight: 800; letter-spacing: 0.2mm; }
        .ln { font-size: 3.1mm; color: #222; margin-top: 1mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        @media print { body { padding: 3mm; } }
      </style></head><body>${cards.join('')}</body></html>`;
      const w = window.open('', '_blank');
      if (!w) { this.error = 'Allow pop-ups for this site to print labels.'; return; }
      w.document.write(html);
      w.document.close();
      setTimeout(() => { try { w.focus(); w.print(); } catch { /* user closed it */ } }, 450);
    } finally {
      this.labelsBusy = false;
    }
  }

  // ── Misc ──
  switchOrder(id: string): void {
    if (id && id !== this.orderId) this.router.navigate(['/work-orders', id]);
  }

  tagOf(t: string): string { return t === 'subassembly' ? 'SUB' : t === 'part' ? 'PART' : t === 'group' ? 'GRP' : 'ASM'; }
  itemStatusLabel(s: string): string { return ITEM_STATUS_LABEL[s] ?? s; }
  stageStatusLabel(s: string): string { return STAGE_STATUS_LABEL[s] ?? s; }
  orderStatusLabel(s: string): string { return ORDER_STATUS_LABEL[s] ?? s; }

  shipIcon(s: ShipStatus): string {
    return s === 'ready' ? 'local_shipping' : s === 'shipped' ? 'done_all' : s === 'allocated' ? 'schedule_send' : s === 'blocked_ncr' ? 'report_problem' : 'precision_manufacturing';
  }
  shipLabel(it: AuditItem): string {
    switch (it.shipStatus) {
      case 'ready': return `Ready to ship · ${it.shipReadyQty}`;
      case 'shipped': return 'Shipped';
      case 'allocated': return 'On a load';
      case 'blocked_ncr': return 'Ship blocked — NCR';
      default: return 'In production';
    }
  }

  evText(ev: StageEventRow): string {
    if (ev.action === 'status' || ev.action === 'bulk_status') {
      return `set ${this.stageStatusLabel(ev.fromStatus ?? '')} → ${this.stageStatusLabel(ev.toStatus ?? '')}`;
    }
    return `set count ${ev.fromQty ?? 0} → ${ev.toQty ?? 0}`;
  }
  evIcon(ev: StageEventRow): string {
    if (ev.toStatus === 'completed') return 'check_circle';
    if (ev.toStatus === 'skipped') return 'skip_next';
    if (ev.toStatus === 'pending') return 'restart_alt';
    if (ev.action === 'qty' || ev.action === 'bulk_qty') return 'pin';
    return 'sync_alt';
  }
  evTone(ev: StageEventRow): string {
    if (ev.toStatus === 'completed') return 'good';
    if (ev.toStatus === 'skipped' || ev.toStatus === 'pending') return 'mute';
    return 'info';
  }

  fmtDur(s: number | null | undefined): string {
    const v = Math.max(0, Math.floor(s ?? 0));
    const h = Math.floor(v / 3600);
    const m = Math.floor((v % 3600) / 60);
    const sec = v % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  fmtLen(mm: number): string { return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${Math.round(mm)} mm`; }
  fmtKg(kg: number): string { return `${kg >= 100 ? Math.round(kg) : kg.toFixed(1)} kg`; }
}
