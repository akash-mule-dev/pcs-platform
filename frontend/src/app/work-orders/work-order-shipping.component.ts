import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProjectsService, ProductionOrder, ShipmentTraceability } from '../core/services/projects.service';
import { ShippingService, Shipment, ShipmentStatus, ShipReadyRow, DeliveryNote, QcPackage } from '../core/services/shipping.service';
import { ToastService } from '../core/services/toast.service';

const ORDER_STATUS_LABEL: Record<string, string> = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };

/**
 * Shipping for ONE work order (production order) — lives in the /work-orders/:id
 * namespace, NOT the project. Build loads (trucks/lifts) and add the assemblies
 * THIS order has fabricated to production-complete. Readiness, allocation and
 * shipped totals all come from this order's own ship board; the project stays a
 * pure design container.
 */
@Component({
  selector: 'app-work-order-shipping',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      <a class="back" [routerLink]="['/work-orders', orderId]"><mat-icon>arrow_back</mat-icon><span>Work order</span></a>

      <header class="head">
        <div class="title">
          <mat-icon class="t-ico">local_shipping</mat-icon>
          <h1>Shipping</h1>
          @if (order) {
            <span class="wo mono">{{ order.number }}</span>
            <span class="pill st-{{ order.status }}">{{ statusLabel(order.status) }}</span>
          }
        </div>
        <div class="meta">
          @if (order?.customerName) { <span class="m"><mat-icon>business</mat-icon>{{ order?.customerName }}</span> }
          @if (order) { <span class="m"><mat-icon>tag</mat-icon>Order qty {{ order.quantity }}</span> }
          @if (order?.dueDate) { <span class="m"><mat-icon>event</mat-icon>Due {{ order?.dueDate | date:'mediumDate' }}</span> }
          <span class="m" [class.good]="totalReady > 0"><mat-icon>inventory</mat-icon>{{ totalReady }} ready · {{ totalShipped }} shipped</span>
        </div>
      </header>

      @if (error) { <p class="banner err"><mat-icon>block</mat-icon>{{ error }}<button class="dismiss" (click)="error = null">×</button></p> }

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
                    <button class="icon-x" (click)="printDeliveryNote(s); $event.stopPropagation()" [disabled]="!s.items.length" title="Delivery note / packing slip (PDF)">
                      <mat-icon>receipt_long</mat-icon>
                    </button>
                    <button class="icon-x" (click)="printQcPackage(s); $event.stopPropagation()" [disabled]="!s.items.length || qcBusy === s.id" title="QC sign-off package (inspections, NCRs, MTR, releasability)">
                      <mat-icon>fact_check</mat-icon>
                    </button>
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
                              <span class="mtr-miss"><mat-icon>warning</mat-icon>no heat number — assign on the project's Assemblies tab</span>
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
            <p class="hint">Assemblies of this work order whose pieces have finished every stage. Select a load on the left, then add.</p>
            @if (heldCount() > 0) {
              <p class="banner warn"><mat-icon>warning</mat-icon>{{ heldCount() }} item(s) have an open NCR and are blocked from shipping until resolved.</p>
            }
            @if (loadingBoard) {
              <div class="center"><mat-spinner diameter="28"></mat-spinner></div>
            } @else if (ready.length === 0) {
              <div class="empty-state slim"><mat-icon>check_circle</mat-icon><p>Nothing ready yet. Complete an assembly's stages on the board to see it here.</p></div>
            } @else {
              @for (n of ready; track n.nodeId) {
                <div class="ready" [class.allocated]="n.availableQty === 0" [class.blocked]="n.blocked">
                  <mat-icon class="r-ico">widgets</mat-icon>
                  <span class="r-name">{{ n.mark || n.name }}</span>
                  @if (n.blocked) { <span class="qa-hold" title="Open NCR — resolve before shipping"><mat-icon>warning</mat-icon>NCR</span> }
                  @if (n.availableQty > 1) { <span class="r-q">×{{ n.availableQty }}</span> }
                  @if (n.weightKg && n.availableQty > 0) { <span class="r-w">{{ n.weightKg * n.availableQty | number:'1.0-0' }} kg</span> }
                  <span class="spacer"></span>
                  @if (n.availableQty === 0) {
                    @if (n.shippedQty > 0 && n.allocatedQty === 0) {
                      <span class="on-load shipped"><mat-icon>done_all</mat-icon>Shipped</span>
                    } @else {
                      <span class="on-load"><mat-icon>inventory_2</mat-icon>On a load</span>
                    }
                  } @else {
                    <button class="btn outline sm" [disabled]="!selectedShipmentId || busy || n.blocked" (click)="addToShipment(n)"><mat-icon>add</mat-icon>Add</button>
                  }
                </div>
              }
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 1200px; margin: 0 auto; }
    .mono { font-family: 'Space Grotesk', monospace; }
    .back { display: inline-flex; align-items: center; gap: 4px; color: var(--clay-text-muted); font-size: 13px; font-weight: 500; margin-bottom: 10px; text-decoration: none; }
    .back:hover { color: var(--clay-primary); }
    .back mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .head { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 14px 18px; box-shadow: var(--clay-shadow-soft); margin-bottom: 16px; }
    .title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .t-ico { color: var(--clay-primary); }
    .title h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: var(--clay-text); }
    .wo { font-size: 13px; font-weight: 700; color: var(--clay-text-secondary); background: var(--clay-bg-warm); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); padding: 2px 8px; }
    .pill { padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .st-planned { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .st-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .st-completed { background: var(--success-bg); color: var(--success-text); }
    .st-cancelled { background: var(--danger-bg); color: var(--danger-text); }
    .meta { display: flex; gap: 6px 16px; flex-wrap: wrap; margin-top: 8px; }
    .m { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--clay-text-secondary); }
    .m mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--clay-text-muted); }
    .m.good { color: var(--success-text); font-weight: 700; }

    .center { display: flex; justify-content: center; padding: 48px 0; }
    .banner { display: flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 10px 12px; font-size: 13px; margin: 0 0 12px; }
    .banner mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .banner.err { background: var(--danger-bg); color: var(--danger-text); }
    .banner.warn { background: var(--warning-bg); color: var(--warning-text); }
    .dismiss { margin-left: auto; background: none; border: none; color: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
    .empty-state.slim { padding: 36px 20px; text-align: center; color: var(--clay-text-muted); } .empty-state.slim mat-icon { font-size: 38px; width: 38px; height: 38px; opacity: .5; }
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
    .sel-hint mat-icon { font-size: 15px; width: 15px; height: 15px; }

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
    .ready { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 9px 12px; margin-bottom: 8px; box-shadow: var(--clay-shadow-soft); }
    .ready.allocated { opacity: .65; }
    .ready.blocked { border-color: var(--danger); }
    .on-load { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: var(--clay-text-muted); background: var(--clay-bg-warm); border-radius: 999px; padding: 2px 9px; }
    .on-load.shipped { color: var(--success-text); background: var(--success-bg); }
    .on-load mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .spacer { flex: 1; }
    @media (max-width: 860px) { .layout { flex-direction: column; } .nl-grid { grid-template-columns: 1fr; } }
  `],
})
export class WorkOrderShippingComponent implements OnInit {
  private svc = inject(ProjectsService);
  private shippingSvc = inject(ShippingService);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);

  orderId = '';
  projectId = '';
  order: ProductionOrder | null = null;

  shipments: Shipment[] = [];
  ready: ShipReadyRow[] = [];
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

  // ── MTR / traceability rollup ──
  mtrFor: string | null = null;
  qcBusy: string | null = null;
  mtr: ShipmentTraceability | null = null;

  readonly statuses: ShipmentStatus[] = ['planned', 'loaded', 'shipped', 'delivered', 'cancelled'];

  get totalReady(): number { return this.ready.reduce((a, n) => a + n.availableQty, 0); }
  get totalShipped(): number { return this.ready.reduce((a, n) => a + n.shippedQty, 0); }

  ngOnInit(): void {
    this.orderId = this.route.snapshot.paramMap.get('id') ?? '';
    this.svc.getOrder(this.orderId).subscribe({
      next: (o) => { this.order = o; this.projectId = o.projectId; },
      error: () => {},
    });
    this.loadShipments();
    this.loadBoard();
  }

  statusLabel(s: string): string { return ORDER_STATUS_LABEL[s] ?? s; }

  private loadShipments(): void {
    this.loadingShipments = true;
    this.shippingSvc.listByOrder(this.orderId).subscribe({
      next: (s) => { this.shipments = s; this.loadingShipments = false; if (!this.newNumber) this.newNumber = `LOAD-${s.length + 1}`; },
      error: () => { this.loadingShipments = false; },
    });
  }

  /** Readiness from THIS order's ship board (server computes complete/shipped/allocated). */
  private loadBoard(): void {
    this.loadingBoard = true;
    this.shippingSvc.shipBoard(this.orderId).subscribe({
      next: (rows) => { this.ready = rows; this.loadingBoard = false; },
      error: (e) => { this.loadingBoard = false; this.error = e?.error?.message || 'Could not load the ship board.'; },
    });
  }

  private refreshAll(): void {
    this.loadShipments();
    this.loadBoard();
  }

  heldCount(): number { return this.ready.filter((n) => n.blocked).length; }

  createShipment(): void {
    if (!this.newNumber) return;
    this.creating = true; this.error = null;
    this.shippingSvc.create({
      productionOrderId: this.orderId, shipmentNumber: this.newNumber,
      destination: this.newDest || undefined, carrier: this.newCarrier || undefined, plannedDate: this.newDate || undefined,
    }).subscribe({
      next: (s) => { this.creating = false; this.newDest = ''; this.newCarrier = ''; this.newDate = ''; this.newNumber = ''; this.selectedShipmentId = s.id; this.loadShipments(); },
      error: (e) => { this.creating = false; this.error = e?.error?.message || 'Could not create load'; },
    });
  }

  addToShipment(n: ShipReadyRow): void {
    if (!this.selectedShipmentId || n.availableQty === 0 || n.blocked) return;
    this.busy = true; this.error = null;
    this.shippingSvc.addItem(this.selectedShipmentId, n.nodeId, n.availableQty).subscribe({
      next: () => { this.busy = false; this.refreshAll(); },
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not add assembly'; },
    });
  }
  removeItem(s: Shipment, item: { id: string }): void {
    this.shippingSvc.removeItem(s.id, item.id).subscribe({ next: () => this.refreshAll(), error: () => {} });
  }
  changeStatus(s: Shipment, status: ShipmentStatus): void {
    this.shippingSvc.setStatus(s.id, status).subscribe({ next: () => { this.refreshAll(); this.toast.success('Shipment updated'); }, error: (e) => (this.error = e?.error?.message || 'Could not update status') });
  }
  remove(s: Shipment): void {
    this.shippingSvc.remove(s.id).subscribe({ next: () => { if (this.selectedShipmentId === s.id) this.selectedShipmentId = null; this.refreshAll(); }, error: () => {} });
  }

  toggleMtr(s: Shipment): void {
    if (this.mtrFor === s.id) { this.mtrFor = null; this.mtr = null; return; }
    this.mtrFor = s.id;
    this.mtr = null;
    if (!this.projectId) return;
    this.svc.shipmentTraceability(this.projectId, s.id).subscribe({
      next: (t) => { if (this.mtrFor === s.id) this.mtr = t; },
      error: () => { if (this.mtrFor === s.id) this.mtrFor = null; },
    });
  }

  /** Open a print-optimized delivery note / packing slip → browser "Save as PDF". */
  printDeliveryNote(s: Shipment): void {
    this.shippingSvc.deliveryNote(s.id).subscribe({
      next: (dn) => {
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(this.deliveryNoteHtml(dn));
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 350);
      },
      error: () => {},
    });
  }

  private esc(v: unknown): string {
    return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  }

  private deliveryNoteHtml(dn: DeliveryNote): string {
    const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const rows = dn.items.map((it, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="mark">${this.esc(it.mark || it.name || '—')}</td>
        <td>${this.esc(it.profile || '')}</td>
        <td>${this.esc(it.materialGrade || '')}</td>
        <td class="r">${it.quantity}</td>
        <td class="r">${it.unitWeightKg != null ? it.unitWeightKg.toFixed(1) : '—'}</td>
        <td class="r">${it.lineWeightKg != null ? it.lineWeightKg.toFixed(1) : '—'}</td>
        <td class="heats">${it.heats.map((h) => this.esc(h.heatNumber || h.lotNumber)).join(', ')}</td>
      </tr>`).join('');
    const hasHeats = dn.items.some((it) => it.heats.length);
    return `<!doctype html><html><head><meta charset="utf-8">
<title>Delivery Note ${this.esc(dn.shipment.number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a2b34; margin: 32px; font-size: 12px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #123; padding-bottom: 14px; }
  .org { font-size: 20px; font-weight: 800; letter-spacing: -0.3px; }
  .doc-title { text-align: right; }
  .doc-title h1 { margin: 0; font-size: 22px; letter-spacing: 1px; color: #123; }
  .doc-title .num { font-size: 15px; font-weight: 700; margin-top: 2px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 18px 0 22px; }
  .meta .row { display: flex; gap: 8px; }
  .meta .lbl { color: #6b7c85; font-weight: 600; min-width: 96px; text-transform: uppercase; font-size: 10px; letter-spacing: .5px; padding-top: 1px; }
  .meta .val { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #123; color: #fff; text-align: left; padding: 7px 8px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; }
  td { padding: 6px 8px; border-bottom: 1px solid #dde3e6; }
  td.r, th.r { text-align: right; }
  td.c, th.c { text-align: center; width: 28px; }
  td.mark { font-weight: 700; }
  td.heats { font-size: 10.5px; color: #44555e; }
  tfoot td { font-weight: 800; border-top: 2px solid #123; border-bottom: none; background: #f3f6f7; }
  .notes { margin-top: 18px; padding: 10px 12px; background: #f7f9fa; border-left: 3px solid #123; font-size: 11px; }
  .sign { display: flex; gap: 48px; margin-top: 44px; }
  .sign div { flex: 1; border-top: 1px solid #8a9aa2; padding-top: 5px; font-size: 10.5px; color: #6b7c85; }
  .foot { margin-top: 26px; font-size: 9.5px; color: #93a2a8; text-align: center; }
  @media print { body { margin: 14mm; } .noprint { display: none; } }
</style></head><body>
  <div class="top">
    <div><div class="org">${this.esc(dn.organization.name)}</div><div style="color:#6b7c85;margin-top:2px">Delivery Note / Packing Slip</div></div>
    <div class="doc-title"><h1>DELIVERY NOTE</h1><div class="num">${this.esc(dn.shipment.number)}</div></div>
  </div>
  <div class="meta">
    <div class="row"><span class="lbl">Project</span><span class="val">${this.esc(dn.project.name)}${dn.project.number ? ' (' + this.esc(dn.project.number) + ')' : ''}</span></div>
    <div class="row"><span class="lbl">Work order</span><span class="val">${this.esc(dn.order.number || '—')}</span></div>
    <div class="row"><span class="lbl">Client</span><span class="val">${this.esc(dn.order.customerName || dn.project.client || '—')}</span></div>
    <div class="row"><span class="lbl">Date</span><span class="val">${fmtDate(dn.shipment.shippedAt || dn.shipment.plannedDate)}</span></div>
    <div class="row"><span class="lbl">Destination</span><span class="val">${this.esc(dn.shipment.destination || '—')}</span></div>
    <div class="row"><span class="lbl">Status</span><span class="val">${this.esc(dn.shipment.status)}</span></div>
    <div class="row"><span class="lbl">Carrier</span><span class="val">${this.esc(dn.shipment.carrier || '—')}</span></div>
  </div>
  <table>
    <thead><tr><th class="c">#</th><th>Mark</th><th>Profile</th><th>Grade</th><th class="r">Qty</th><th class="r">Unit kg</th><th class="r">Line kg</th><th>${hasHeats ? 'Heat / Lot' : ''}</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td></td><td>Total</td><td></td><td></td><td class="r">${dn.totals.pieces}</td><td></td><td class="r">${dn.totals.weightKg.toFixed(1)}</td><td></td></tr></tfoot>
  </table>
  ${dn.shipment.notes ? `<div class="notes"><strong>Notes:</strong> ${this.esc(dn.shipment.notes)}</div>` : ''}
  <div class="sign"><div>Dispatched by / date</div><div>Received by / date</div></div>
  <div class="foot">${dn.totals.lines} line item(s) · generated ${new Date(dn.generatedAt).toLocaleString()}${hasHeats ? ' · heat numbers shown are mill-certified material lots (MTR on file)' : ''}</div>
</body></html>`;
  }

  /** Open the QC sign-off package (inspections + NCRs + MTR + releasability) → browser "Save as PDF". */
  printQcPackage(s: Shipment): void {
    if (this.qcBusy) return;
    this.qcBusy = s.id;
    this.shippingSvc.qcPackage(s.id).subscribe({
      next: (pkg) => {
        this.qcBusy = null;
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(this.qcPackageHtml(pkg));
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 350);
      },
      error: () => { this.qcBusy = null; },
    });
  }

  private qcPackageHtml(pkg: QcPackage): string {
    const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const rel = pkg.qc.releasability;
    const dispLabel = (d: string | null) => ({ rework: 'Rework', repair: 'Repair', use_as_is: 'Use as-is', scrap: 'Scrap', return_to_supplier: 'Return to supplier' } as Record<string, string>)[d ?? ''] ?? (d ?? '—');

    const mtrRows = pkg.items.map((it, i) => `
      <tr><td class="c">${i + 1}</td><td class="mark">${this.esc(it.mark || it.name || '—')}</td>
      <td>${this.esc(it.profile || '')}</td><td>${this.esc(it.materialGrade || '')}</td>
      <td class="r">${it.quantity}</td>
      <td class="heats">${it.heats.length ? it.heats.map((h) => this.esc((h.heatNumber || h.lotNumber) + (h.certReference ? ` (cert ${h.certReference})` : ''))).join(', ') : '<span class="gap">— no MTR —</span>'}</td></tr>`).join('');

    const inspRows = pkg.qc.inspections.length ? pkg.qc.inspections.map((q) => `
      <tr><td class="mark">${this.esc(q.node_mark || q.mesh_name || '—')}</td>
      <td><span class="b b-${this.esc(q.status || '')}">${this.esc(q.status || '—')}</span>${q.signoff_status === 'approved' ? ' <span class="b b-ok">signed</span>' : (q.status === 'fail' ? ' <span class="b b-warn">unsigned</span>' : '')}</td>
      <td>${q.measurement_value != null ? this.esc(q.measurement_value + (q.measurement_unit || '')) : '—'}</td>
      <td>${this.esc(q.defect_type || '')}</td><td>${this.esc(q.inspector || '')}</td><td>${fmtDate(q.created_at)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No inspection records for the shipped items.</td></tr>';

    const ncrRows = pkg.qc.ncrs.length ? pkg.qc.ncrs.map((n) => `
      <tr><td class="mark">${this.esc(n.number)}</td><td>${this.esc(n.node_mark || '—')}</td>
      <td><span class="b b-${n.resolved_at ? 'ok' : 'bad'}">${this.esc((n.ncr_status || (n.resolved_at ? 'closed' : 'open')).replace('_', ' '))}</span></td>
      <td>${this.esc(dispLabel(n.disposition))}</td>
      <td>${this.esc(n.root_cause || '')}${n.concession_reason ? `<div class="sub">Concession: ${this.esc(n.concession_reason)}</div>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">No non-conformances raised against the shipped items.</td></tr>';

    return `<!doctype html><html><head><meta charset="utf-8">
<title>QC Package ${this.esc(pkg.shipment.number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a2b34; margin: 32px; font-size: 12px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #123; padding-bottom: 14px; }
  .org { font-size: 20px; font-weight: 800; letter-spacing: -0.3px; }
  .doc-title { text-align: right; }
  .doc-title h1 { margin: 0; font-size: 21px; letter-spacing: 1px; color: #123; }
  .doc-title .num { font-size: 15px; font-weight: 700; margin-top: 2px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 16px 0 18px; }
  .meta .row { display: flex; gap: 8px; }
  .meta .lbl { color: #6b7c85; font-weight: 600; min-width: 96px; text-transform: uppercase; font-size: 10px; letter-spacing: .5px; padding-top: 1px; }
  .meta .val { font-weight: 600; }
  .rel { display: flex; align-items: center; gap: 14px; padding: 11px 14px; border-radius: 6px; margin-bottom: 20px; font-weight: 700; }
  .rel.ok { background: #e7f6ec; color: #1b6e3a; } .rel.bad { background: #fdeaea; color: #b3261e; }
  .rel .badge { font-size: 18px; }
  .rel .det { font-weight: 600; font-size: 11px; color: #44555e; margin-left: auto; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: #123; border-bottom: 2px solid #123; padding-bottom: 4px; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  th { background: #123; color: #fff; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
  td { padding: 6px 8px; border-bottom: 1px solid #dde3e6; vertical-align: top; }
  td.r, th.r { text-align: right; } td.c, th.c { text-align: center; width: 28px; }
  td.mark { font-weight: 700; }
  td.heats { font-size: 10.5px; color: #44555e; } .gap { color: #b3261e; font-weight: 700; }
  td.empty { color: #93a2a8; text-align: center; font-style: italic; }
  .sub { font-size: 10px; color: #6b7c85; margin-top: 2px; }
  .b { padding: 1px 7px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: capitalize; }
  .b-pass, .b-ok { background: #e7f6ec; color: #1b6e3a; } .b-fail, .b-bad { background: #fdeaea; color: #b3261e; }
  .b-warning, .b-warn { background: #fdf3e0; color: #92560a; }
  .foot { margin-top: 24px; font-size: 9.5px; color: #93a2a8; text-align: center; }
  @media print { body { margin: 14mm; } }
</style></head><body>
  <div class="top">
    <div><div class="org">${this.esc(pkg.organization.name)}</div><div style="color:#6b7c85;margin-top:2px">Quality Sign-off Package</div></div>
    <div class="doc-title"><h1>QC PACKAGE</h1><div class="num">${this.esc(pkg.shipment.number)}</div></div>
  </div>
  <div class="meta">
    <div class="row"><span class="lbl">Project</span><span class="val">${this.esc(pkg.project.name)}${pkg.project.number ? ' (' + this.esc(pkg.project.number) + ')' : ''}</span></div>
    <div class="row"><span class="lbl">Work order</span><span class="val">${this.esc(pkg.order.number || '—')}</span></div>
    <div class="row"><span class="lbl">Client</span><span class="val">${this.esc(pkg.order.customerName || pkg.project.client || '—')}</span></div>
    <div class="row"><span class="lbl">Date</span><span class="val">${fmtDate(pkg.shipment.shippedAt || pkg.shipment.plannedDate)}</span></div>
  </div>
  <div class="rel ${rel.releasable ? 'ok' : 'bad'}">
    <span class="badge">${rel.releasable ? '✓' : '⚠'}</span>
    <span>${rel.releasable ? 'RELEASABLE — no open NCRs or unsigned failures' : 'NOT RELEASABLE — resolve the items below'}</span>
    <span class="det">${rel.openNcrs} open NCR(s) · ${rel.unsignedFailures} unsigned failure(s) · ${rel.itemsMissingMtr} item(s) missing MTR</span>
  </div>

  <h2>Material traceability (MTR)</h2>
  <table>
    <thead><tr><th class="c">#</th><th>Mark</th><th>Profile</th><th>Grade</th><th class="r">Qty</th><th>Heat / Lot / Cert</th></tr></thead>
    <tbody>${mtrRows}</tbody>
  </table>

  <h2>Inspections (${pkg.qc.inspections.length})</h2>
  <table>
    <thead><tr><th>Item</th><th>Result</th><th>Measurement</th><th>Defect</th><th>Inspector</th><th>Date</th></tr></thead>
    <tbody>${inspRows}</tbody>
  </table>

  <h2>Non-conformances (${pkg.qc.ncrs.length})</h2>
  <table>
    <thead><tr><th>NCR</th><th>Item</th><th>State</th><th>Disposition</th><th>Root cause / concession</th></tr></thead>
    <tbody>${ncrRows}</tbody>
  </table>

  <div class="foot">QC sign-off package · ${pkg.qc.scopeNodeCount} node(s) in scope · generated ${new Date(pkg.generatedAt).toLocaleString()}</div>
</body></html>`;
  }
}
