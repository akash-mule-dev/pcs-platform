import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProjectsService, OrderBoard, OrderBoardItem, OrderStageRow } from '../core/services/projects.service';

const SS_LABEL: Record<string, string> = { pending: 'Queued', in_progress: 'In progress', completed: 'Done', skipped: 'Skipped' };
/** Cards rendered per column before "Show more" (keeps 100+ item orders fast). */
const PAGE = 30;

interface CardVM {
  nodeId: string; mark: string; tag: string;
  status: string; statusLabel: string;
  qtyDone: number; qtyTotal: number;
  wosId: string; seq: number; outOfSeq: boolean; saving: boolean;
}
interface ColVM { id: string; name: string; cards: CardVM[]; total: number; }

/**
 * Board tab of the order workspace. Steppers are OPTIMISTIC: taps update the
 * card instantly and the latest count is sent (debounced) as one absolute
 * update — rapid +/+/+ never loses a tap to an in-flight request. Columns
 * render in pages of ${PAGE} with a search box, so 100+ item orders stay fast.
 */
@Component({
  selector: 'app-order-board',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="board">
      @if (loading) {
        <div class="center"><mat-spinner diameter="30"></mat-spinner></div>
      } @else if (!board) {
        <div class="empty"><p>Work order not found.</p></div>
      } @else {
        @if (error) { <p class="err"><mat-icon>block</mat-icon>{{ error }}<button class="dismiss" (click)="error = null">×</button></p> }

        <div class="toolbar">
          <div class="bsearch">
            <mat-icon>search</mat-icon>
            <input type="text" placeholder="Search items…" [ngModel]="query" (ngModelChange)="onQuery($event)">
            @if (query) { <button class="clear" (click)="onQuery('')">×</button> }
          </div>
          @if (query) { <span class="hits">{{ filteredCount }} match(es)</span> }
        </div>

        <div class="columns">
          @for (c of columns; track c.id) {
            <div class="col">
              <div class="col-head"><span>{{ c.name }}</span><span class="cnt">{{ c.total }}</span></div>
              <div class="col-body">
                @for (card of c.cards; track card.wosId) {
                  <div class="pcard" [class.saving]="card.saving">
                    <div class="pmark">
                      <span class="tag">{{ card.tag }}</span>{{ card.mark }}
                      @if (card.saving) { <mat-spinner class="card-spin" diameter="12"></mat-spinner> }
                    </div>
                    <div class="prow">
                      <span class="ss ss-{{ card.status }}">{{ card.statusLabel }}</span>
                      @if (card.outOfSeq) { <span class="ooseq" title="An earlier stage of this item is still open">⚠ out of sequence</span> }
                      <span class="qty">{{ card.qtyDone }}/{{ card.qtyTotal }}</span>
                    </div>
                    <div class="step">
                      <button [disabled]="card.qtyDone <= 0" (click)="dec(card)">−</button>
                      <button [disabled]="card.qtyDone >= card.qtyTotal" (click)="inc(card)">+</button>
                      <button class="all" [disabled]="card.saving" (click)="setStatus(card, 'completed')">All</button>
                      <button [disabled]="card.saving" (click)="setStatus(card, 'pending')">Reset</button>
                    </div>
                  </div>
                } @empty { <p class="cempty">Nothing here</p> }
                @if (c.total > c.cards.length) {
                  <button class="more" (click)="showMore(c.id)">Show {{ Math.min(50, c.total - c.cards.length) }} more ({{ c.total - c.cards.length }} hidden)</button>
                }
              </div>
            </div>
          }
          <div class="col done-col">
            <div class="col-head"><span>✓ Done</span><span class="cnt">{{ doneTotal }}</span></div>
            <div class="col-body">
              @for (card of doneCards; track card.nodeId) {
                <div class="pcard done"><div class="pmark"><span class="tag">{{ card.tag }}</span>{{ card.mark }}</div></div>
              } @empty { <p class="cempty">—</p> }
              @if (doneTotal > doneCards.length) { <p class="cempty">+{{ doneTotal - doneCards.length }} more</p> }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .center, .empty { display: flex; align-items: center; justify-content: center; padding: 48px 0; color: var(--clay-text-muted); }
    .err { display: flex; align-items: center; gap: 6px; background: var(--danger-bg); color: var(--danger-text); border-radius: var(--clay-radius-sm); padding: 9px 12px; font-size: 13px; margin: 0 0 12px; }
    .err mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .err .dismiss { margin-left: auto; background: none; border: none; color: var(--danger-text); font-size: 15px; font-weight: 700; cursor: pointer; }

    .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .bsearch { display: flex; align-items: center; gap: 5px; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 5px 9px; }
    .bsearch mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); }
    .bsearch input { border: none; outline: none; background: transparent; font-size: 13px; color: var(--clay-text); font-family: inherit; width: 190px; }
    .bsearch .clear { background: none; border: none; color: var(--clay-text-muted); cursor: pointer; font-size: 15px; font-weight: 700; padding: 0 2px; }
    .hits { font-size: 12px; color: var(--clay-text-muted); }

    .columns { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; align-items: flex-start; }
    .col { flex: 0 0 230px; background: var(--clay-bg-warm); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); }
    .done-col { background: var(--clay-surface); }
    .col-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--clay-text-secondary); border-bottom: 1px solid var(--clay-border); }
    .col-head .cnt { background: var(--clay-surface); border-radius: 999px; padding: 1px 8px; color: var(--clay-text); }
    .col-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; min-height: 40px; }
    .cempty { color: var(--clay-text-muted); font-size: 12px; text-align: center; margin: 6px 0; }
    .more { background: var(--clay-surface); border: 1px dashed var(--clay-border); border-radius: var(--clay-radius-sm); padding: 7px; font-size: 12px; font-weight: 600; color: var(--clay-primary); cursor: pointer; font-family: inherit; }
    .more:hover { border-color: var(--clay-primary); }

    .pcard { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 9px 10px; }
    .pcard.done { opacity: .7; }
    .pcard.saving { border-color: var(--clay-primary); }
    .pmark { font-size: 13px; font-weight: 700; color: var(--clay-text); display: flex; align-items: center; gap: 6px; }
    .card-spin { margin-left: auto; }
    .tag { font-size: 9px; font-weight: 800; color: var(--clay-primary); background: var(--info-bg); border-radius: 4px; padding: 1px 4px; }
    .prow { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
    .ss { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; }
    .ss-pending { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .ss-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .ss-completed { background: var(--success-bg); color: var(--success-text); }
    .ss-skipped { background: var(--clay-bg-warm); color: var(--clay-text-muted); }
    .ooseq { font-size: 10px; font-weight: 700; color: var(--warning-text); }
    .qty { font-size: 13px; font-weight: 700; color: var(--clay-text); margin-left: auto; }
    .step { display: flex; gap: 5px; margin-top: 8px; }
    .step button { flex: 1; border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text); border-radius: var(--clay-radius-xs); padding: 5px 0; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .step button:disabled { opacity: .4; cursor: default; }
    .step .all { color: var(--success-text); border-color: var(--success-text); flex: 1.2; font-size: 11px; }
  `],
})
export class OrderBoardComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private svc = inject(ProjectsService);

  readonly Math = Math;

  projectId = '';
  orderId = '';
  board: OrderBoard | null = null;
  columns: ColVM[] = [];
  doneCards: { nodeId: string; mark: string; tag: string }[] = [];
  doneTotal = 0;
  itemCount = 0;
  filteredCount = 0;
  loading = true;
  error: string | null = null;
  query = '';

  private limits = new Map<string, number>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Per-stage debounce timers for the optimistic stepper. */
  private sendTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private savingIds = new Set<string>();
  /** Stable "#n" suffixes for repeated marks, so duplicates are tellable apart. */
  private markLabels = new Map<string, string>();

  /** Find a route param on this route or any ancestor (board renders as a child of orders/:orderId). */
  private param(name: string): string {
    let r: ActivatedRoute | null = this.route;
    while (r) {
      const v = r.snapshot.paramMap.get(name);
      if (v) return v;
      r = r.parent;
    }
    return '';
  }

  ngOnInit(): void {
    this.orderId = this.param('orderId');
    this.projectId = this.param('id');
    this.load();
    // Light auto-refresh; skipped while the tab is hidden or edits are in flight.
    this.pollTimer = setInterval(() => {
      if (document.hidden || this.loading || this.sendTimers.size > 0 || this.savingIds.size > 0) return;
      this.refresh();
    }, 10000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    // Flush pending stepper updates so no taps are lost on navigation.
    for (const wosId of [...this.sendTimers.keys()]) this.flushSend(wosId);
  }

  load(): void {
    this.loading = true;
    this.svc.orderBoard(this.orderId).subscribe({
      next: (b) => { this.board = b; this.projectId = b.order.projectId || this.projectId; this.recompute(); this.loading = false; },
      error: () => { this.board = null; this.loading = false; },
    });
  }

  /** Silent reload (no spinner); never interrupts optimistic edits. */
  private refresh(): void {
    this.svc.orderBoard(this.orderId).subscribe({
      next: (b) => {
        if (this.sendTimers.size > 0 || this.savingIds.size > 0) return; // edits in flight — keep local truth
        this.board = b; this.recompute();
      },
      error: () => { /* keep the last good board */ },
    });
  }

  onQuery(v: string): void { this.query = v; this.limits.clear(); this.recompute(); }
  showMore(colId: string): void { this.limits.set(colId, (this.limits.get(colId) ?? PAGE) + 50); this.recompute(); }

  /** Build plain view-models once per change (no method calls in the template → no CD churn). */
  private recompute(): void {
    const items = this.board?.items ?? [];
    const stages = this.board?.stages ?? [];
    this.itemCount = items.length;

    // Duplicate marks get a stable "#n" suffix.
    const markCounts = new Map<string, number>();
    for (const it of items) markCounts.set(it.mark, (markCounts.get(it.mark) ?? 0) + 1);
    const seen = new Map<string, number>();
    this.markLabels.clear();
    for (const it of items) {
      if ((markCounts.get(it.mark) ?? 0) > 1) {
        const n = (seen.get(it.mark) ?? 0) + 1;
        seen.set(it.mark, n);
        this.markLabels.set(it.nodeId, `${it.mark} #${n}`);
      } else {
        this.markLabels.set(it.nodeId, it.mark);
      }
    }

    const term = this.query.trim().toLowerCase();
    const tagOf = (t: string) => (t === 'subassembly' ? 'SUB' : t === 'part' ? 'PART' : 'ASM');
    const isDone = (it: OrderBoardItem) => it.stages.length > 0 && it.stages.every((s) => s.status === 'completed' || s.status === 'skipped');
    const matches = (it: OrderBoardItem) => !term || (this.markLabels.get(it.nodeId) ?? it.mark).toLowerCase().includes(term);

    let filtered = 0;
    this.columns = stages.map((s) => {
      const cards: CardVM[] = [];
      let total = 0;
      const limit = this.limits.get(s.id) ?? PAGE;
      for (const it of items) {
        if (isDone(it) || !matches(it)) continue;
        const r = it.stages.find((x) => x.stageId === s.id);
        if (!r || (r.status !== 'pending' && r.status !== 'in_progress')) continue;
        total++;
        if (cards.length >= limit) continue;
        const firstOpenSeq = Math.min(...it.stages.filter((x) => x.status !== 'completed' && x.status !== 'skipped').map((x) => x.sequence));
        cards.push({
          nodeId: it.nodeId,
          mark: this.markLabels.get(it.nodeId) ?? it.mark,
          tag: tagOf(it.nodeType),
          status: r.status,
          statusLabel: SS_LABEL[r.status] ?? r.status,
          qtyDone: r.qtyDone,
          qtyTotal: r.qtyTotal,
          wosId: r.workOrderStageId,
          seq: r.sequence,
          // Flag real anomalies only: progress on THIS stage while an earlier stage
          // is still open (the column guard already excludes completed rows).
          outOfSeq: r.qtyDone > 0 && r.sequence > firstOpenSeq,
          saving: this.savingIds.has(r.workOrderStageId) || this.sendTimers.has(r.workOrderStageId),
        });
      }
      filtered = Math.max(filtered, total);
      return { id: s.id, name: s.name, cards, total };
    });
    this.filteredCount = filtered;

    const done = items.filter((it) => isDone(it) && matches(it));
    this.doneTotal = done.length;
    this.doneCards = done.slice(0, PAGE).map((it) => ({ nodeId: it.nodeId, mark: this.markLabels.get(it.nodeId) ?? it.mark, tag: tagOf(it.nodeType) }));
  }

  /** The source-of-truth stage row backing a card. */
  private rowOf(card: CardVM): OrderStageRow | null {
    const it = this.board?.items.find((x) => x.nodeId === card.nodeId);
    return it?.stages.find((s) => s.workOrderStageId === card.wosId) ?? null;
  }

  private deriveStatus(qtyDone: number, qtyTotal: number): string {
    if (qtyTotal > 0 && qtyDone >= qtyTotal) return 'completed';
    return qtyDone > 0 ? 'in_progress' : 'pending';
  }

  /** Optimistic stepper: update locally NOW, debounce one absolute send. */
  private bump(card: CardVM, delta: number): void {
    const r = this.rowOf(card);
    if (!r) return;
    const next = Math.max(0, Math.min(r.qtyTotal, r.qtyDone + delta));
    if (next === r.qtyDone) return;
    r.qtyDone = next;
    r.status = this.deriveStatus(next, r.qtyTotal);
    this.recompute();

    const existing = this.sendTimers.get(card.wosId);
    if (existing) clearTimeout(existing);
    this.sendTimers.set(card.wosId, setTimeout(() => this.flushSend(card.wosId), 600));
  }
  inc(card: CardVM): void { this.bump(card, +1); }
  dec(card: CardVM): void { this.bump(card, -1); }

  private flushSend(wosId: string): void {
    const t = this.sendTimers.get(wosId);
    if (t) { clearTimeout(t); this.sendTimers.delete(wosId); }
    const it = this.board?.items.find((x) => x.stages.some((s) => s.workOrderStageId === wosId));
    const r = it?.stages.find((s) => s.workOrderStageId === wosId);
    if (!r) return;
    this.savingIds.add(wosId);
    this.recompute();
    this.svc.setOrderStage(this.orderId, wosId, { qtyDone: r.qtyDone }).subscribe({
      next: () => { this.savingIds.delete(wosId); this.recompute(); },
      error: (e) => {
        this.savingIds.delete(wosId);
        this.error = e?.error?.message || 'Could not update the stage.';
        this.refresh(); // resync to server truth
      },
    });
  }

  /** All / Reset: optimistic too, but sent immediately. */
  setStatus(card: CardVM, status: 'completed' | 'pending'): void {
    const r = this.rowOf(card);
    if (!r) return;
    const prev = { qtyDone: r.qtyDone, status: r.status };
    r.qtyDone = status === 'completed' ? r.qtyTotal : 0;
    r.status = status;
    this.savingIds.add(card.wosId);
    this.recompute();
    this.svc.setOrderStage(this.orderId, card.wosId, { status }).subscribe({
      next: () => { this.savingIds.delete(card.wosId); this.recompute(); },
      error: (e) => {
        this.savingIds.delete(card.wosId);
        const rr = this.rowOf(card);
        if (rr) { rr.qtyDone = prev.qtyDone; rr.status = prev.status; }
        this.error = e?.error?.message || 'Could not update the stage.';
        this.recompute();
      },
    });
  }
}
