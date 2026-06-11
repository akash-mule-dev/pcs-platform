import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProjectsService, ProductionOrder, CreateOrder } from '../core/services/projects.service';
import { ProjectWorkspaceStore } from './project-workspace.store';

/** Work orders (production instances) for a project — list + create, inside the project workspace. */
@Component({
  selector: 'app-project-orders',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="orders">
      <div class="head">
        <p class="hint">Each work order is one production run (e.g. for a customer) — its own process &amp; quantity, tracked independently.</p>
        <button class="new-btn" (click)="open = !open">
          <mat-icon>{{ open ? 'close' : 'add' }}</mat-icon><span>{{ open ? 'Cancel' : 'New work order' }}</span>
        </button>
      </div>

      @if (open) {
        <div class="form">
          <div class="frow">
            <label>Customer<input type="text" [(ngModel)]="customer" placeholder="Optional"></label>
            <label>Quantity<input type="number" min="1" [(ngModel)]="quantity"></label>
          </div>
          <label>Process
            <select [(ngModel)]="processId">
              <option value="">— pick a process —</option>
              @for (p of processes; track p.id) { <option [value]="p.id">{{ p.name }}</option> }
            </select>
          </label>
          @if (!processId) {
            <button class="std" [disabled]="creating" (click)="useStandard()">
              <mat-icon>auto_awesome</mat-icon>Use standard process (Cut → Fit → Weld → QC → Paint)
            </button>
          }
          <button class="create" [disabled]="creating || !processId" (click)="create()">{{ creating ? 'Creating…' : 'Create & release' }}</button>
        </div>
      }
      @if (error) { <p class="err">{{ error }}</p> }

      @if (loading) {
        <div class="center"><mat-spinner diameter="30"></mat-spinner></div>
      } @else if (orders.length === 0) {
        <div class="empty"><mat-icon>receipt_long</mat-icon><p>No work orders yet. Create one to start tracking production.</p></div>
      } @else {
        <div class="grid">
          @for (o of orders; track o.id) {
            <a class="card" [routerLink]="['/projects', projectId, 'orders', o.id]">
              <div class="card-top">
                <span class="num">{{ o.number }}</span>
                <span class="pill st-{{ o.status }}">{{ statusLabel(o.status) }}</span>
              </div>
              <div class="meta">
                @if (o.customerName) { <span><mat-icon>business</mat-icon>{{ o.customerName }}</span> }
                <span><mat-icon>tag</mat-icon>Qty {{ o.quantity }}</span>
              </div>
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .hint { color: var(--clay-text-secondary); font-size: 13px; margin: 0; flex: 1; min-width: 220px; }
    .new-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--clay-primary); color: #fff; border: none; border-radius: var(--clay-radius-sm); padding: 9px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .new-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .form { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 12px; }
    .frow { display: flex; gap: 12px; flex-wrap: wrap; }
    label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); flex: 1; min-width: 140px; }
    input, select { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); padding: 8px 10px; font-size: 14px; font-family: inherit; }
    .create { align-self: flex-start; background: var(--clay-primary); color: #fff; border: none; border-radius: var(--clay-radius-sm); padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
    .create:disabled { opacity: .5; cursor: default; }
    .std { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; background: transparent; color: var(--clay-primary); border: 1px dashed var(--clay-primary); border-radius: var(--clay-radius-sm); padding: 7px 12px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .std mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .std:disabled { opacity: .5; cursor: default; }
    .err { color: var(--danger-text); font-size: 13px; }
    .center, .empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 0; color: var(--clay-text-muted); }
    .empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
    .card { display: block; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 14px 16px; text-decoration: none; transition: border-color .15s, transform .1s; }
    .card:hover { border-color: var(--clay-primary); transform: translateY(-1px); }
    .card-top { display: flex; align-items: center; justify-content: space-between; }
    .num { font-size: 15px; font-weight: 700; color: var(--clay-text); }
    .pill { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .st-planned { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .st-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .st-completed { background: var(--success-bg); color: var(--success-text); }
    .st-cancelled { background: var(--danger-bg); color: var(--danger-text); }
    .meta { display: flex; gap: 14px; margin-top: 8px; flex-wrap: wrap; }
    .meta span { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--clay-text-secondary); }
    .meta mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--clay-text-muted); }
  `],
})
export class ProjectOrdersComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private svc = inject(ProjectsService);
  private store = inject(ProjectWorkspaceStore, { optional: true });

  projectId = '';
  orders: ProductionOrder[] = [];
  processes: { id: string; name: string }[] = [];
  loading = true;
  error: string | null = null;

  open = false;
  customer = '';
  quantity = 1;
  processId = '';
  creating = false;

  ngOnInit(): void {
    this.projectId = this.route.parent?.snapshot.paramMap.get('id') ?? this.route.snapshot.paramMap.get('id') ?? '';
    this.svc.listProcesses().subscribe({ next: (p) => (this.processes = p), error: () => {} });
    this.load();
  }

  load(): void {
    this.loading = true;
    this.svc.listOrders(this.projectId).subscribe({
      next: (o) => { this.orders = o; this.loading = false; },
      error: (e) => { this.error = e?.error?.message || 'Could not load work orders.'; this.loading = false; },
    });
  }

  /** One click: get-or-create the org's Standard Fabrication process and select it. */
  useStandard(): void {
    this.creating = true; this.error = null;
    this.svc.ensureStandardProcess().subscribe({
      next: (p) => {
        this.creating = false;
        if (!this.processes.some((x) => x.id === p.id)) this.processes = [...this.processes, { id: p.id, name: p.name }];
        this.processId = p.id;
      },
      error: (e) => { this.creating = false; this.error = e?.error?.message || 'Could not create the standard process.'; },
    });
  }

  create(): void {
    if (!this.processId) { this.error = 'Pick a process for this work order.'; return; }
    this.creating = true; this.error = null;
    const body: CreateOrder = { processId: this.processId, customerName: this.customer.trim() || undefined, quantity: Math.max(1, Number(this.quantity) || 1) };
    this.svc.createOrder(this.projectId, body).subscribe({
      next: () => {
        this.creating = false; this.open = false; this.customer = ''; this.quantity = 1; this.processId = ''; this.load();
        // Keep the workspace header live (order count, items in production, nodes).
        this.store?.refreshOrders(); this.store?.refreshProgress(); this.store?.refreshNodes();
      },
      error: (e) => { this.creating = false; this.error = e?.error?.message || 'Could not create work order.'; },
    });
  }

  statusLabel(s: string): string {
    return ({ planned: 'Planned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' } as Record<string, string>)[s] ?? s;
  }
}
