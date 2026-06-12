import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { ProjectsService, OrderBoardItem, NodeQualityStatus, ShipmentTraceability } from '../core/services/projects.service';
import { ShippingService, Shipment, ShipmentStatus } from '../core/services/shipping.service';

/** An assembly of this work order with production-complete units available to load. */
interface ReadyRow { nodeId: string; mark: string; readyUnits: number; weightKg: number | null; }

/** Shipping tab: build loads (shipments) and add production-complete assemblies.
 *  Readiness comes from THIS work order's stage counts (an assembly is ready
 *  once its units have been through every stage); loads are project-wide. */
@Component({
  selector: 'app-project-shipping',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    @if (error) { <p class="banner err">{{ error }}</p> }

    @if (loadingShipments && shipments.length === 0) {
      <div class="center"><mat-spinner diameter="32"></mat-spinner></div>
    } @else {
      <div class="layout">
        <!-- Loads -->
        <section class="col">
          <div class="col-head"><h2><mat-icon>inventory_2</mat-icon>Loads</h2><span class="count">{{ shipments.length }}</span></div>

          <div class="newload">
            <div class="nl-grid">
              <input type="text" [(ngModel)]="newNumber" placeholder="Load # (e.g. LOAD-1)">
              <input type="text" [(ngModel)]="newDest" placeholder="Destination">
              <input type="text" [(ngModel)]="newCarrier" placeholder="Carrier">
              <input type="date" [(ngModel)]="newDate">
            </div>
            <button class="btn primary" [disabled]="creating || !newNumber" (click)="createShipment()"><mat-icon>add</mat-icon>{{ creating ? 'Creating…' : 'New load' }}</button>
          </div>

          @if (shipments.length === 0) {
            <div class="empty-state slim"><mat-icon>inbox</mat-icon><p>No loads yet. Create one, then add ready assemblies.</p></div>
          } @else {
            @for (s of shipments; track s.id) {
              <div class="load-card" [class.sel]="selectedShipmentId === s.id" (click)="selectedShipmentId = s.id">
                <div class="lc-head">
                  <strong>{{ s.shipmentNumber }}</strong>
                  <span class="chip sh-{{ s.status }}">{{ s.status }}</span>
                  <span class="spacer"></span>
                  <select class="st-select" [ngModel]="s.status" (ngModelChange)="changeStatus(s, $event)" (click)="$event.stopPropagation()">
                    @for (st of statuses; track st) { <option [value]="st">{{ st }}</option> }
                  </select>
                  <button class="icon-x" (click)="toggleMtr(s); $event.stopPropagation()" [title]="mtrFor === s.id ? 'Hide MTR package' : 'MTR package: heat numbers + certs per item'">
                    <mat-icon>{{ mtrFor === s.id ? 'expand_less' : 'verified' }}</mat-icon>
                  </button>
                  <button class="icon-x" (click)="remove(s); $event.stopPropagation()" title="Delete load"><mat-icon>delete</mat-icon></button>
                </div>
                <div class="lc-meta">
                  @if (s.destination) { <span><mat-icon>place</mat-icon>{{ s.destination }}</span> }
                  @if (s.carrier) { <span><mat-icon>local_shipping</mat-icon>{{ s.carrier }}</span> }
                  @if (s.plannedDate) { <span><mat-icon>event</mat-icon>{{ s.plannedDate | date:'mediumDate' }}</span> }
                </div>
                <div class="lc-items">
                  @if (s.items.length) {
                    @for (it of s.items; track it.id) {
                      <div class="li">
                        <mat-icon class="li-ico">widgets</mat-icon>
                        <span class="li-name">{{ it.assemblyNode?.mark || it.assemblyNode?.name || 'Assembly' }}</span>
                        @if (qaHold(it.assemblyNode?.id)) { <span class="qa-hold" [title]="qaHoldLabel(it.assemblyNode?.id)"><mat-icon>warning</mat-icon>QC</span> }
                        @if (it.quantity > 1) { <span class="li-q">×{{ it.quantity }}</span> }
                        <span class="spacer"></span>
                        <button class="icon-x sm" (click)="removeItem(s, it); $event.stopPropagation()" title="Remove"><mat-icon>close</mat-icon></button>
                      </div>
                    }
                  } @else { <p class="li-empty">No assemblies on this load yet.</p> }
                </div>
                @if (selectedShipmentId === s.id) { <div class="sel-hint"><mat-icon>arrow_forward</mat-icon>Selected — add ready assemblies from the right</div> }

                <!-- MTR / traceability rollup -->
                @if (mtrFor === s.id) {
                  <div class="mtr" (click)="$event.stopPropagation()">
                    @if (!mtr) {
                      <div class="mtr-loading"><mat-spinner diameter="18"></mat-spinner>Building MTR package…</div>
                    } @else {
                      <div class="mtr-head">
                        <mat-icon>verified</mat-icon><strong>MTR package</strong>
                        <span class="mtr-sum ok">{{ mtr.summary.covered }}/{{ mtr.summary.items }} items covered</span>
                        @if (mtr.summary.missing > 0) { <span class="mtr-sum bad">{{ mtr.summary.missing }} missing heat numbers</span> }
                      </div>
                      @for (it of mtr.items; track it.itemId) {
                        <div class="mtr-row" [class.gap]="!it.covered">
                          <span class="mtr-mark">{{ it.mark || it.name }}</span>
                          @if (it.covered) {
                            <span class="mtr-lots">
                              @for (l of it.lots; track l.lotNumber) {
                                <span class="heat" [title]="(l.material || '') + (l.supplier ? ' · ' + l.supplier : '') + (l.certReference ? ' · cert ' + l.certReference : '')">{{ l.heatNumber || l.lotNumber }}</span>
                              }
                            </span>
                          } @else {
                            <span class="mtr-miss"><mat-icon>warning</mat-icon>no heat number — assign on the Assemblies tab</span>
                          }
                        </div>
                      }
                    }
                  </div>
                }
              </div>
            }
          }
        </section>

        <!-- Ready to ship -->
        <section class="col">
          <div class="col-head"><h2><mat-icon>checklist</mat-icon>Ready to ship</h2><span class="count">{{ ready.length }}</span></div>
          <p class="hint">Assemblies of this work order whose units have finished every stage. Select a load on the left, then add.</p>
          @if (heldCount() > 0) {
            <p class="banner warn"><mat-icon>warning</mat-icon>{{ heldCount() }} ready item(s) have a quality hold (failed QC or open NCR). Items with open NCRs are blocked from shipping until resolved.</p>
          }
          @if (loadingBoard) {
            <div class="center"><mat-spinner diameter="28"></mat-spinner></div>
          } @else if (ready.length === 0) {
            <div class="empty-state slim"><mat-icon>check_circle</mat-icon><p>Nothing ready yet. Complete an assembly's stages on the board to see it here.</p></div>
          } @else {
            @for (n of ready; track n.nodeId) {
              <div class="ready" [class.allocated]="available(n) === 0">
                <mat-icon class="r-ico">widgets</mat-icon>
                <span class="r-name">{{ n.mark }}</span>
                @if (qaHold(n.nodeId)) { <span class="qa-hold" [title]="qaHoldLabel(n.nodeId)"><mat-icon>warning</mat-icon>{{ qaHoldLabel(n.nodeId) }}</span> }
                @if (available(n) > 1) { <span class="r-q">×{{ available(n) }}</span> }
                @if (n.weightKg && available(n) > 0) { <span class="r-w">{{ n.weightKg * available(n) | number:'1.0-0' }} kg</span> }
                <span class="spacer"></span>
                @if (available(n) === 0) {
                  <span class="on-load"><mat-icon>inventory_2</mat-icon>On a load</span>
                } @else {
                  <button class="btn outline sm" [disabled]="!selectedShipmentId || busy" (click)="addToShipment(n)"><mat-icon>add</mat-icon>Add</button>
                }
              </div>
            }
          }
        </section>
      </div>
    }
  `,
  styles: [`
    .center { display: flex; justify-content: center; padding: 48px 0; }
    .banner { display: flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 10px 12px; font-size: 13px; margin: 0 0 12px; }
    .banner mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .banner.err { background: var(--danger-bg); color: var(--danger-text); }
    .banner.warn { background: var(--warning-bg); color: var(--warning-text); }
    .empty-state.slim { padding: 36px 20px; } .empty-state.slim mat-icon { font-size: 38px; width: 38px; height: 38px; }
    .hint { color: var(--clay-text-muted); font-size: 12px; margin: 0 0 12px; }

    .layout { display: flex; gap: 20px; align-items: flex-start; }
    .col { flex: 1; min-width: 0; }
    .col-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .col-head h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; margin: 0; color: var(--clay-text); }
    .col-head h2 mat-icon { font-size: 20px; width: 20px; height: 20px; color: var(--clay-text-muted); }
    .count { background: var(--info-bg); color: var(--clay-primary); border-radius: 999px; padding: 1px 9px; font-size: 12px; font-weight: 700; }

    .newload { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 12px; margin-bottom: 14px; box-shadow: var(--clay-shadow-soft); }
    .nl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
    .newload input { padding: 8px 10px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); font-size: 13px; background: var(--clay-surface); color: var(--clay-text); font-family: inherit; }
    .btn { display: inline-flex; align-items: center; gap: 5px; border-radius: var(--clay-radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; border: 1px solid var(--clay-border); transition: all .15s; }
    .btn mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .btn.sm { padding: 5px 10px; font-size: 12px; }
    .btn.primary { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); width: 100%; justify-content: center; }
    .btn.primary:hover:not(:disabled) { filter: brightness(1.08); }
    .btn.outline { background: transparent; color: var(--clay-primary); border-color: var(--clay-primary); }
    .btn.outline:hover:not(:disabled) { background: var(--info-bg); }
    .btn:disabled { opacity: .5; cursor: default; }

    .load-card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 12px 14px; margin-bottom: 12px; cursor: pointer; transition: all .15s; box-shadow: var(--clay-shadow-soft); }
    .load-card:hover { border-color: var(--clay-primary); }
    .load-card.sel { border-color: var(--clay-primary); box-shadow: 0 0 0 2px var(--info-bg); }
    .lc-head { display: flex; align-items: center; gap: 8px; }
    .lc-head strong { font-size: 14px; color: var(--clay-text); font-family: 'Space Grotesk', monospace; }
    .st-select { padding: 4px 6px; border-radius: var(--clay-radius-xs); border: 1px solid var(--clay-border); font-size: 12px; text-transform: capitalize; background: var(--clay-surface); color: var(--clay-text); font-family: inherit; }
    .icon-x { width: 30px; height: 30px; border: none; background: transparent; color: var(--clay-text-muted); border-radius: var(--clay-radius-xs); cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .icon-x:hover { color: var(--danger); background: var(--danger-bg); } .icon-x.sm { width: 24px; height: 24px; } .icon-x mat-icon { font-size: 17px; width: 17px; height: 17px; } .icon-x.sm mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .lc-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--clay-text-muted); font-size: 12px; margin: 6px 0 8px; }
    .lc-meta span { display: inline-flex; align-items: center; gap: 4px; } .lc-meta mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .lc-items { display: flex; flex-direction: column; gap: 4px; }
    .li, .ready { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .li-ico, .r-ico { font-size: 17px; width: 17px; height: 17px; color: var(--clay-primary); flex-shrink: 0; }
    .li-name, .r-name { font-weight: 600; color: var(--clay-text); }
    .li-q, .r-q { color: var(--clay-text-muted); font-size: 12px; } .r-w { color: var(--clay-text-muted); font-size: 12px; }
    .li-empty { color: var(--clay-text-muted); font-size: 12px; margin: 2px 0; }
    .chip { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: capitalize; }
    .sh-planned { background: var(--info-bg); color: var(--info-text); } .sh-loaded { background: var(--warning-bg); color: var(--warning-text); }
    .sh-shipped { background: var(--badge-progress-bg); color: var(--badge-progress-text); } .sh-delivered { background: var(--success-bg); color: var(--success-text); } .sh-cancelled { background: var(--danger-bg); color: var(--danger-text); }
    .qa-hold { display: inline-flex; align-items: center; gap: 3px; background: var(--danger-bg); color: var(--danger-text); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 700; }
    .qa-hold mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .sel-hint { display: flex; align-items: center; gap: 5px; color: var(--clay-primary); font-size: 12px; font-weight: 600; margin-top: 8px; }

    /* ── MTR / traceability rollup ── */
    .mtr { margin-top: 10px; border-top: 1px dashed var(--clay-border); padding-top: 8px; }
    .mtr-loading { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--clay-text-muted); padding: 6px 0; }
    .mtr-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
    .mtr-head mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--clay-primary); }
    .mtr-head strong { font-size: 12.5px; color: var(--clay-text); }
    .mtr-sum { border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 700; }
    .mtr-sum.ok { background: var(--success-bg); color: var(--success-text); }
    .mtr-sum.bad { background: var(--danger-bg); color: var(--danger-text); }
    .mtr-row { display: flex; align-items: flex-start; gap: 8px; padding: 3px 0; font-size: 12px; flex-wrap: wrap; }
    .mtr-row.gap { color: var(--danger-text); }
    .mtr-mark { font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk', monospace; min-width: 60px; }
    .mtr-lots { display: flex; gap: 4px; flex-wrap: wrap; }
    .heat { background: var(--info-bg); color: var(--clay-primary); border-radius: var(--clay-radius-xs); padding: 0 7px; font-size: 11px; font-weight: 700; font-family: 'Space Grotesk', monospace; }
    .mtr-miss { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--danger-text); }
    .mtr-miss mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .sel-hint mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .ready { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 9px 12px; margin-bottom: 8px; box-shadow: var(--clay-shadow-soft); }
    .ready.allocated { opacity: .65; }
    .on-load { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: var(--clay-text-muted); background: var(--clay-bg-warm); border-radius: 999px; padding: 2px 9px; }
    .on-load mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .spacer { flex: 1; }
    @media (max-width: 860px) { .layout { flex-direction: column; } .nl-grid { grid-template-columns: 1fr; } }
  `],
})
export class ProjectShippingComponent implements OnInit {
  // ── MTR / traceability rollup ──
  mtrFor: string | null = null;
  mtr: ShipmentTraceability | null = null;

  toggleMtr(s: Shipment): void {
    if (this.mtrFor === s.id) { this.mtrFor = null; this.mtr = null; return; }
    this.mtrFor = s.id;
    this.mtr = null;
    this.svc.shipmentTraceability(this.store.id(), s.id).subscribe({
      next: (t) => { if (this.mtrFor === s.id) this.mtr = t; },
      error: () => { if (this.mtrFor === s.id) this.mtrFor = null; },
    });
  }

  store = inject(ProjectWorkspaceStore);
  private svc = inject(ProjectsService);
  private shippingSvc = inject(ShippingService);
  private route = inject(ActivatedRoute);

  orderId = '';
  shipments: Shipment[] = [];
  ready: ReadyRow[] = [];
  loadingShipments = true;
  loadingBoard = true;
  error: string | null = null;

  selectedShipmentId: string | null = null;
  creating = false;
  busy = false;
  newNumber = '';
  newDest = '';
  newCarrier = '';
  newDate = '';

  readonly statuses: ShipmentStatus[] = ['planned', 'loaded', 'shipped', 'delivered', 'cancelled'];

  ngOnInit(): void {
    this.orderId = this.route.parent?.snapshot.paramMap.get('orderId')
      ?? this.route.snapshot.paramMap.get('orderId') ?? '';
    this.loadShipments();
    this.loadBoard();
    // The store may predate recent inspections — refresh so QC holds are current.
    this.store.refreshNodes();
    this.store.refreshQuality();
  }

  private loadShipments(): void {
    this.loadingShipments = true;
    this.shippingSvc.listByProject(this.store.id()).subscribe({
      next: (s) => { this.shipments = s; this.loadingShipments = false; this.newNumber = this.newNumber || `LOAD-${s.length + 1}`; },
      error: () => { this.loadingShipments = false; },
    });
  }

  /** Readiness from THIS order's stage counts: a unit is ready once it has been through every non-skipped stage. */
  private loadBoard(): void {
    if (!this.orderId) { this.loadingBoard = false; return; }
    this.loadingBoard = true;
    this.svc.orderBoard(this.orderId).subscribe({
      next: (b) => {
        const weightByNode = new Map(this.store.nodes().map((n) => [n.id, n.weightKg]));
        this.ready = (b.items ?? [])
          .map((it) => ({ nodeId: it.nodeId, mark: it.mark, readyUnits: this.readyUnits(it), weightKg: weightByNode.get(it.nodeId) ?? null }))
          .filter((r) => r.readyUnits > 0);
        this.loadingBoard = false;
      },
      error: (e) => { this.loadingBoard = false; this.error = e?.error?.message || 'Could not load the work-order board.'; },
    });
  }

  private readyUnits(it: OrderBoardItem): number {
    const active = (it.stages ?? []).filter((s) => s.status !== 'skipped');
    if (!active.length) return 0;
    const allDone = active.every((s) => s.status === 'completed');
    const minDone = Math.min(...active.map((s) => Math.max(0, Math.min(s.qtyDone ?? 0, s.qtyTotal ?? 0))));
    return allDone ? Math.max(minDone, 1) : minDone;
  }

  private refreshAll(): void {
    this.loadShipments();
    this.loadBoard();
  }

  /** Units of this node already on loads that are not cancelled (planned, loaded, shipped or delivered). */
  allocated(nodeId: string): number {
    let sum = 0;
    for (const s of this.shipments) {
      if (s.status === 'cancelled') continue;
      for (const it of s.items ?? []) if (it.assemblyNode?.id === nodeId || (it as any).assemblyNodeId === nodeId) sum += it.quantity ?? 1;
    }
    return sum;
  }
  /** Units still free to put on a load. */
  available(n: ReadyRow): number { return Math.max(0, n.readyUnits - this.allocated(n.nodeId)); }

  private qaEntry(nodeId: string | undefined | null): NodeQualityStatus | null {
    if (!nodeId) return null;
    return this.store.quality()?.nodes[nodeId] ?? null;
  }
  qaHold(nodeId: string | undefined | null): boolean { const e = this.qaEntry(nodeId); return !!e && (e.status === 'fail' || e.openNcr > 0); }
  qaHoldLabel(nodeId: string | undefined | null): string {
    const e = this.qaEntry(nodeId);
    if (!e) return '';
    if (e.openNcr > 0 && e.status === 'fail') return 'Failed QC + NCR';
    if (e.openNcr > 0) return 'Open NCR';
    if (e.status === 'fail') return 'Failed QC';
    return '';
  }
  heldCount(): number { return this.ready.filter((n) => this.qaHold(n.nodeId)).length; }

  createShipment(): void {
    if (!this.newNumber) return;
    this.creating = true; this.error = null;
    this.shippingSvc.create({
      projectId: this.store.id(), shipmentNumber: this.newNumber,
      destination: this.newDest || undefined, carrier: this.newCarrier || undefined, plannedDate: this.newDate || undefined,
    }).subscribe({
      next: (s) => { this.creating = false; this.newDest = ''; this.newCarrier = ''; this.newDate = ''; this.newNumber = ''; this.selectedShipmentId = s.id; this.loadShipments(); },
      error: (e) => { this.creating = false; this.error = e?.error?.message || 'Could not create load'; },
    });
  }

  addToShipment(n: ReadyRow): void {
    if (!this.selectedShipmentId || this.available(n) === 0) return;
    this.busy = true; this.error = null;
    this.shippingSvc.addItem(this.selectedShipmentId, n.nodeId, this.available(n)).subscribe({
      next: () => { this.busy = false; this.refreshAll(); },
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not add assembly'; },
    });
  }
  removeItem(s: Shipment, item: { id: string }): void {
    this.shippingSvc.removeItem(s.id, item.id).subscribe({ next: () => this.refreshAll(), error: () => {} });
  }
  changeStatus(s: Shipment, status: ShipmentStatus): void {
    this.shippingSvc.setStatus(s.id, status).subscribe({ next: () => this.refreshAll(), error: (e) => (this.error = e?.error?.message || 'Could not update status') });
  }
  remove(s: Shipment): void {
    this.shippingSvc.remove(s.id).subscribe({ next: () => { if (this.selectedShipmentId === s.id) this.selectedShipmentId = null; this.refreshAll(); }, error: () => {} });
  }
}
