import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProjectsService, OrderBoard, OrderBoardItem, OrderStageRow } from '../core/services/projects.service';

const SS_LABEL: Record<string, string> = { pending: 'Queued', in_progress: 'In progress', completed: 'Done', skipped: 'Skipped' };

interface CardVM { nodeId: string; mark: string; tag: string; status: string; statusLabel: string; qtyDone: number; qtyTotal: number; wosId: string; }
interface ColVM { id: string; name: string; cards: CardVM[]; }

/** Board tab of the order workspace: columns = stages (+ Done); cards = assemblies/parts with per-stage counts + stepper. */
@Component({
  selector: 'app-order-board',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="board">
      @if (loading) {
        <div class="center"><mat-spinner diameter="30"></mat-spinner></div>
      } @else if (!board) {
        <div class="empty"><p>Work order not found.</p></div>
      } @else {
        @if (error) { <p class="err"><mat-icon>block</mat-icon>{{ error }}</p> }

        <div class="columns">
          @for (c of columns; track c.id) {
            <div class="col">
              <div class="col-head"><span>{{ c.name }}</span><span class="cnt">{{ c.cards.length }}</span></div>
              <div class="col-body">
                @for (card of c.cards; track card.nodeId) {
                  <div class="pcard">
                    <div class="pmark"><span class="tag">{{ card.tag }}</span>{{ card.mark }}</div>
                    <div class="prow">
                      <span class="ss ss-{{ card.status }}">{{ card.statusLabel }}</span>
                      <span class="qty">{{ card.qtyDone }}/{{ card.qtyTotal }}</span>
                    </div>
                    <div class="step">
                      <button [disabled]="busy || card.qtyDone <= 0" (click)="dec(card)">−</button>
                      <button [disabled]="busy || card.qtyDone >= card.qtyTotal" (click)="inc(card)">+</button>
                      <button class="all" [disabled]="busy" (click)="setStatus(card, 'completed')">All</button>
                      <button [disabled]="busy" (click)="setStatus(card, 'pending')">Reset</button>
                    </div>
                  </div>
                } @empty { <p class="cempty">Nothing here</p> }
              </div>
            </div>
          }
          <div class="col done-col">
            <div class="col-head"><span>✓ Done</span><span class="cnt">{{ doneCards.length }}</span></div>
            <div class="col-body">
              @for (card of doneCards; track card.nodeId) {
                <div class="pcard done"><div class="pmark"><span class="tag">{{ card.tag }}</span>{{ card.mark }}</div></div>
              } @empty { <p class="cempty">—</p> }
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
    .columns { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; align-items: flex-start; }
    .col { flex: 0 0 230px; background: var(--clay-bg-warm); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); }
    .done-col { background: var(--clay-surface); }
    .col-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--clay-text-secondary); border-bottom: 1px solid var(--clay-border); }
    .col-head .cnt { background: var(--clay-surface); border-radius: 999px; padding: 1px 8px; color: var(--clay-text); }
    .col-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; min-height: 40px; }
    .cempty { color: var(--clay-text-muted); font-size: 12px; text-align: center; margin: 6px 0; }
    .pcard { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 9px 10px; }
    .pcard.done { opacity: .7; }
    .pmark { font-size: 13px; font-weight: 700; color: var(--clay-text); display: flex; align-items: center; gap: 6px; }
    .tag { font-size: 9px; font-weight: 800; color: var(--clay-primary); background: var(--info-bg); border-radius: 4px; padding: 1px 4px; }
    .prow { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
    .ss { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; }
    .ss-pending { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .ss-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .ss-completed { background: var(--success-bg); color: var(--success-text); }
    .ss-skipped { background: var(--clay-bg-warm); color: var(--clay-text-muted); }
    .qty { font-size: 13px; font-weight: 700; color: var(--clay-text); }
    .step { display: flex; gap: 5px; margin-top: 8px; }
    .step button { flex: 1; border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text); border-radius: var(--clay-radius-xs); padding: 5px 0; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .step button:disabled { opacity: .4; cursor: default; }
    .step .all { color: var(--success-text); border-color: var(--success-text); flex: 1.2; font-size: 11px; }
  `],
})
export class OrderBoardComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private svc = inject(ProjectsService);

  projectId = '';
  orderId = '';
  board: OrderBoard | null = null;
  columns: ColVM[] = [];
  doneCards: { nodeId: string; mark: string; tag: string }[] = [];
  itemCount = 0;
  loading = true;
  busy = false;
  error: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

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
    // Light auto-refresh so progress made elsewhere (e.g. mobile operators) shows up live.
    this.pollTimer = setInterval(() => { if (!this.busy && !this.loading) this.refresh(); }, 10000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  load(): void {
    this.loading = true;
    this.svc.orderBoard(this.orderId).subscribe({
      next: (b) => { this.board = b; this.projectId = b.order.projectId || this.projectId; this.recompute(); this.loading = false; },
      error: () => { this.board = null; this.loading = false; },
    });
  }

  /** Silent reload (no spinner) used by polling and after stage updates. */
  private refresh(): void {
    this.svc.orderBoard(this.orderId).subscribe({
      next: (b) => { this.board = b; this.recompute(); },
      error: () => { /* keep the last good board */ },
    });
  }

  /** Build plain view-models once per load (no method calls in the template → no CD churn). */
  private recompute(): void {
    const items = this.board?.items ?? [];
    const stages = this.board?.stages ?? [];
    this.itemCount = items.length;
    const tagOf = (t: string) => (t === 'subassembly' ? 'SUB' : t === 'part' ? 'PART' : 'ASM');
    const isDone = (it: OrderBoardItem) => it.stages.length > 0 && it.stages.every((s) => s.status === 'completed' || s.status === 'skipped');
    this.columns = stages.map((s) => {
      const cards: CardVM[] = [];
      for (const it of items) {
        if (isDone(it)) continue;
        const r = it.stages.find((x) => x.stageId === s.id);
        if (r && (r.status === 'pending' || r.status === 'in_progress')) {
          cards.push({ nodeId: it.nodeId, mark: it.mark, tag: tagOf(it.nodeType), status: r.status, statusLabel: SS_LABEL[r.status] ?? r.status, qtyDone: r.qtyDone, qtyTotal: r.qtyTotal, wosId: r.workOrderStageId });
        }
      }
      return { id: s.id, name: s.name, cards };
    });
    this.doneCards = items.filter(isDone).map((it) => ({ nodeId: it.nodeId, mark: it.mark, tag: tagOf(it.nodeType) }));
  }

  private set(card: CardVM, body: { qtyDone?: number; status?: string }): void {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.svc.setOrderStage(this.orderId, card.wosId, body).subscribe({
      next: () => { this.busy = false; this.refresh(); },
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not update the stage.'; },
    });
  }
  dec(card: CardVM): void { this.set(card, { qtyDone: card.qtyDone - 1 }); }
  inc(card: CardVM): void { this.set(card, { qtyDone: card.qtyDone + 1 }); }
  setStatus(card: CardVM, status: string): void { this.set(card, { status }); }
}
