import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProjectsService, Project, AssemblyNode, ProjectQualitySummary, NodeQualityStatus } from '../core/services/projects.service';
import { ShippingService, Shipment, ShipmentStatus } from '../core/services/shipping.service';

@Component({
  selector: 'app-project-shipping',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      <a class="back" [routerLink]="['/projects', id]"><mat-icon>arrow_back</mat-icon>&nbsp;Back to project</a>
      <div class="head">
        <h1><mat-icon>local_shipping</mat-icon>&nbsp;Shipping{{ project ? ' — ' + project.name : '' }}</h1>
      </div>
      @if (error) { <p class="err">{{ error }}</p> }

      @if (loading) {
        <div class="center"><mat-spinner diameter="36"></mat-spinner></div>
      } @else {
        <div class="layout">
          <!-- Shipments (loads) -->
          <div class="col">
            <h2>Loads</h2>
            <div class="newship">
              <input type="text" [(ngModel)]="newNumber" placeholder="Load # (e.g. LOAD-1)">
              <input type="text" [(ngModel)]="newDest" placeholder="Destination">
              <input type="text" [(ngModel)]="newCarrier" placeholder="Carrier">
              <input type="date" [(ngModel)]="newDate">
              <button mat-flat-button color="primary" [disabled]="creating || !newNumber" (click)="createShipment()">
                {{ creating ? 'Creating…' : 'New load' }}
              </button>
            </div>

            @if (shipments.length === 0) {
              <div class="empty"><mat-icon>inbox</mat-icon><p>No loads yet. Create one, then add ready assemblies.</p></div>
            } @else {
              @for (s of shipments; track s.id) {
                <div class="card" [class.sel]="selectedShipmentId === s.id" (click)="selectedShipmentId = s.id">
                  <div class="card-head">
                    <strong>{{ s.shipmentNumber }}</strong>
                    <span class="chip sh-{{ s.status }}">{{ s.status }}</span>
                    <span class="spacer"></span>
                    <select [ngModel]="s.status" (ngModelChange)="changeStatus(s, $event)" (click)="$event.stopPropagation()">
                      @for (st of statuses; track st) { <option [value]="st">{{ st }}</option> }
                    </select>
                    <button mat-icon-button (click)="remove(s); $event.stopPropagation()" title="Delete load"><mat-icon>delete</mat-icon></button>
                  </div>
                  <div class="meta">
                    @if (s.destination) { <span>{{ s.destination }}</span> }
                    @if (s.carrier) { <span> · {{ s.carrier }}</span> }
                    @if (s.plannedDate) { <span> · planned {{ s.plannedDate | date:'mediumDate' }}</span> }
                    @if (s.shippedAt) { <span> · shipped {{ s.shippedAt | date:'mediumDate' }}</span> }
                  </div>
                  <div class="items">
                    @if (s.items?.length) {
                      @for (it of s.items; track it.id) {
                        <div class="item">
                          <mat-icon>widgets</mat-icon>
                          <span class="im">{{ it.assemblyNode?.mark || it.assemblyNode?.name || 'Assembly' }}</span>
                          @if (qaHold(it.assemblyNode?.id)) { <span class="qa-hold" [attr.title]="qaHoldLabel(it.assemblyNode?.id)">⚠ QC</span> }
                          @if (it.quantity > 1) { <span class="iq">×{{ it.quantity }}</span> }
                          <span class="spacer"></span>
                          <button mat-icon-button (click)="removeItem(s, it); $event.stopPropagation()" title="Remove"><mat-icon>close</mat-icon></button>
                        </div>
                      }
                    } @else { <p class="hint">No assemblies on this load yet.</p> }
                  </div>
                  @if (selectedShipmentId === s.id) { <div class="selhint">Selected — add ready assemblies from the right →</div> }
                </div>
              }
            }
          </div>

          <!-- Ready to ship -->
          <div class="col">
            <h2>Ready to ship <span class="count">{{ readyToShip().length }}</span></h2>
            <p class="hint">Assemblies whose stages are all complete. Select a load, then add.</p>
            @if (heldCount() > 0) {
              <p class="qa-warnbanner">⚠ {{ heldCount() }} ready item(s) have a quality hold (failed QC or open NCR). You can still ship — review first.</p>
            }
            @if (readyToShip().length === 0) {
              <div class="empty"><mat-icon>check_circle</mat-icon><p>Nothing ready yet. Complete an assembly's stages to see it here.</p></div>
            } @else {
              @for (n of readyToShip(); track n.id) {
                <div class="ready">
                  <mat-icon class="t-{{ n.nodeType }}">widgets</mat-icon>
                  <span class="rm">{{ n.mark || n.name }}</span>
                  @if (qaHold(n.id)) { <span class="qa-hold" [attr.title]="qaHoldLabel(n.id)">⚠ {{ qaHoldLabel(n.id) }}</span> }
                  @if (remaining(n) > 1) { <span class="iq">×{{ remaining(n) }}</span> }
                  @if (n.weightKg) { <span class="rw">{{ n.weightKg * remaining(n) | number:'1.0-0' }} kg</span> }
                  <span class="spacer"></span>
                  <button mat-stroked-button color="primary" [disabled]="!selectedShipmentId || busy" (click)="addToShipment(n)">
                    <mat-icon>add</mat-icon>&nbsp;Add
                  </button>
                </div>
              }
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .back { display: inline-flex; align-items: center; color: #6b7280; text-decoration: none; font-size: .9rem; margin-bottom: 12px; }
    .head h1 { display: flex; align-items: center; margin: 0 0 16px; font-size: 1.5rem; }
    .err { color: #b91c1c; font-size: .85rem; }
    .center, .empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 40px 0; color: #6b7280; }
    .empty mat-icon { font-size: 40px; height: 40px; width: 40px; opacity: .5; }
    .hint { color: #6b7280; font-size: .82rem; margin: 4px 0; }
    .layout { display: flex; gap: 20px; align-items: flex-start; }
    .col { flex: 1; min-width: 0; }
    h2 { font-size: 1.05rem; margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
    .count { background: #eef2ff; color: #4338ca; border-radius: 999px; padding: 0 8px; font-size: .8rem; }
    .newship { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .newship input { padding: 7px 10px; border: 1px solid rgba(0,0,0,.15); border-radius: 8px; font-size: .85rem; }
    .card { background: var(--mat-sys-surface, #fff); border: 1px solid rgba(0,0,0,.1); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; cursor: pointer; }
    .card.sel { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,.15); }
    .card-head { display: flex; align-items: center; gap: 8px; }
    .card-head select { padding: 4px 6px; border-radius: 6px; border: 1px solid rgba(0,0,0,.15); font-size: .8rem; text-transform: capitalize; }
    .meta { color: #6b7280; font-size: .82rem; margin: 4px 0 8px; }
    .items { display: flex; flex-direction: column; gap: 4px; }
    .item, .ready { display: flex; align-items: center; gap: 8px; font-size: .88rem; }
    .ready { background: var(--mat-sys-surface, #fff); border: 1px solid rgba(0,0,0,.08); border-radius: 10px; padding: 8px 12px; margin-bottom: 8px; }
    .item mat-icon, .ready mat-icon { font-size: 18px; height: 18px; width: 18px; color: #2563eb; }
    .im, .rm { font-weight: 600; }
    .iq { color: #6b7280; font-size: .8rem; }
    .rw { color: #6b7280; font-size: .8rem; }
    .spacer { flex: 1; }
    .selhint { color: #2563eb; font-size: .78rem; margin-top: 8px; }
    .chip { padding: 1px 8px; border-radius: 999px; font-size: .74rem; font-weight: 600; text-transform: capitalize; }
    .sh-planned { background: #eef2ff; color: #4338ca; } .sh-loaded { background: #fef3c7; color: #b45309; }
    .sh-shipped { background: #e0f2fe; color: #0369a1; } .sh-delivered { background: #ecfdf5; color: #047857; } .sh-cancelled { background: #fee2e2; color: #b91c1c; }
    .qa-hold { background: #fee2e2; color: #b91c1c; border-radius: 999px; padding: 1px 8px; font-size: .72rem; font-weight: 700; }
    .qa-warnbanner { background: #fef3c7; color: #92400e; border: 1px solid rgba(180,83,9,.3); border-radius: 8px; padding: 8px 10px; font-size: .8rem; margin: 4px 0 10px; }
    @media (max-width: 860px) { .layout { flex-direction: column; } }
  `],
})
export class ProjectShippingComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private projectsSvc = inject(ProjectsService);
  private shippingSvc = inject(ShippingService);

  id = '';
  project: Project | null = null;
  shipments: Shipment[] = [];
  nodes: AssemblyNode[] = [];
  qaSummary: ProjectQualitySummary | null = null;
  loading = true;
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
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  load(): void {
    this.loading = true;
    this.projectsSvc.get(this.id).subscribe({ next: (p) => (this.project = p), error: () => {} });
    this.projectsSvc.nodes(this.id).subscribe({ next: (n) => (this.nodes = n), error: () => {} });
    this.projectsSvc.qualitySummary(this.id).subscribe({ next: (q) => (this.qaSummary = q), error: () => {} });
    this.shippingSvc.listByProject(this.id).subscribe({
      next: (s) => { this.shipments = s; this.loading = false; this.newNumber = this.newNumber || `LOAD-${s.length + 1}`; },
      error: () => { this.loading = false; },
    });
  }

  readyToShip(): AssemblyNode[] {
    return this.nodes.filter(
      (n) => (n.nodeType === 'assembly' || n.nodeType === 'subassembly') && n.productionStatus === 'ready_to_ship' && this.remaining(n) > 0,
    );
  }

  remaining(n: AssemblyNode): number {
    return (n.quantity ?? 1) - (n.qtyShipped ?? 0);
  }

  // ── Quality hold (warn-but-allow) ──
  private qaEntry(nodeId: string | undefined | null): NodeQualityStatus | null {
    if (!nodeId) return null;
    return this.qaSummary?.nodes[nodeId] ?? null;
  }
  qaHold(nodeId: string | undefined | null): boolean {
    const e = this.qaEntry(nodeId);
    return !!e && (e.status === 'fail' || e.openNcr > 0);
  }
  qaHoldLabel(nodeId: string | undefined | null): string {
    const e = this.qaEntry(nodeId);
    if (!e) return '';
    if (e.openNcr > 0 && e.status === 'fail') return 'Failed QC + NCR';
    if (e.openNcr > 0) return 'Open NCR';
    if (e.status === 'fail') return 'Failed QC';
    return '';
  }
  heldCount(): number {
    return this.readyToShip().filter((n) => this.qaHold(n.id)).length;
  }

  createShipment(): void {
    if (!this.newNumber) return;
    this.creating = true;
    this.error = null;
    this.shippingSvc.create({
      projectId: this.id,
      shipmentNumber: this.newNumber,
      destination: this.newDest || undefined,
      carrier: this.newCarrier || undefined,
      plannedDate: this.newDate || undefined,
    }).subscribe({
      next: (s) => {
        this.creating = false;
        this.newDest = ''; this.newCarrier = ''; this.newDate = ''; this.newNumber = '';
        this.selectedShipmentId = s.id;
        this.load();
      },
      error: (e) => { this.creating = false; this.error = e?.error?.message || 'Could not create load'; },
    });
  }

  addToShipment(n: AssemblyNode): void {
    if (!this.selectedShipmentId) return;
    this.busy = true;
    this.error = null;
    this.shippingSvc.addItem(this.selectedShipmentId, n.id, this.remaining(n)).subscribe({
      next: () => { this.busy = false; this.load(); },
      error: (e) => { this.busy = false; this.error = e?.error?.message || 'Could not add assembly'; },
    });
  }

  removeItem(s: Shipment, item: { id: string }): void {
    this.shippingSvc.removeItem(s.id, item.id).subscribe({ next: () => this.load(), error: () => {} });
  }

  changeStatus(s: Shipment, status: ShipmentStatus): void {
    this.shippingSvc.setStatus(s.id, status).subscribe({ next: () => this.load(), error: (e) => (this.error = e?.error?.message || 'Could not update status') });
  }

  remove(s: Shipment): void {
    this.shippingSvc.remove(s.id).subscribe({ next: () => { if (this.selectedShipmentId === s.id) this.selectedShipmentId = null; this.load(); }, error: () => {} });
  }
}
