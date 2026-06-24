import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ThreeViewerComponent, ViewerReferenceLength, ViewerColorOverlay } from '../shared/components/three-viewer/three-viewer.component';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { ProjectsService, AssemblyNode, AuditItem, OrderAudit } from '../core/services/projects.service';

/**
 * Per-work-order 3D viewer (the order's "3D" tab) — the web twin of the mobile
 * OrderAssemblies3D. Shows the project model coloured by THIS order's
 * production / ship status (the rest of the model ghosts, so the order's pieces
 * stand out). Tapping a piece shows its live status. A project itself has no
 * status, but a work order does — so the status overlay lives here, not on the
 * project viewer.
 */
@Component({
  selector: 'app-order-viewer',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule, ThreeViewerComponent],
  template: `
    @if (loading() || store.loading()) {
      <div class="center"><mat-spinner diameter="34"></mat-spinner></div>
    } @else if (!modelUrl()) {
      <div class="empty">
        <mat-icon>view_in_ar</mat-icon>
        <p>The 3D model appears here once the project model finishes converting.</p>
      </div>
    } @else if (!hasGeometry()) {
      <div class="empty">
        <mat-icon>view_in_ar</mat-icon>
        <p>This order's pieces aren't linked to the 3D model. Open the project's Assemblies tab to browse the full model.</p>
      </div>
    } @else {
      <div class="bar">
        <span class="hint">
          @if (selectedItem(); as it) {
            <strong>{{ it.mark }}</strong>
            <span class="chip" [style.background]="statusColor(it)">{{ statusLabel(it) }}</span>
            <span class="pct">{{ it.percent | number:'1.0-0' }}%</span>
            @if (it.openNcrs > 0) { <span class="chip ncr">{{ it.openNcrs }} NCR</span> }
          } @else {
            Coloured by this order's status — click a piece for details
          }
        </span>
      </div>
      <div class="viewer-box">
        <app-three-viewer
          [modelUrl]="modelUrl()"
          [colorOverlay]="colorOverlay()"
          [referenceLengths]="referenceLengths()"
          [showTools]="true"
          (meshClicked)="onMeshClicked($event)"></app-three-viewer>
      </div>
    }
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .center, .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 48px 24px; color: var(--clay-text-muted); text-align: center; }
    .empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .empty p { max-width: 420px; font-size: 14px; line-height: 1.5; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 10px 4px; }
    .hint { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--clay-text-muted); flex-wrap: wrap; }
    .hint strong { color: var(--clay-text); font-size: 14px; }
    .chip { color: #fff; border-radius: 999px; padding: 2px 9px; font-size: 11px; font-weight: 700; }
    .chip.ncr { background: var(--danger-text, #c62828); }
    .pct { font-weight: 700; color: var(--clay-text); }
    .viewer-box { height: min(72vh, 680px); border-radius: 12px; overflow: hidden; border: 1px solid var(--clay-border); background: #eaf4fc; }
  `],
})
export class OrderViewerComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private svc = inject(ProjectsService);
  store = inject(ProjectWorkspaceStore);

  orderId = '';
  readonly audit = signal<OrderAudit | null>(null);
  readonly loading = signal(true);
  readonly selectedNodeId = signal<string | null>(null);

  /** Find a route param on this route or any ancestor (3D renders under orders/:orderId). */
  private param(name: string): string {
    let r: ActivatedRoute | null = this.route;
    while (r) { const v = r.snapshot.paramMap.get(name); if (v) return v; r = r.parent; }
    return '';
  }

  ngOnInit(): void {
    this.orderId = this.param('orderId');
    if (!this.orderId) { this.loading.set(false); return; }
    this.svc.orderAudit(this.orderId).subscribe({
      next: (a) => { this.audit.set(a); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  // ── Tree indexes over the project's (already-loaded) nodes ──
  private byId = computed(() => new Map(this.store.nodes().map((n) => [n.id, n])));
  private childrenByParent = computed(() => {
    const m = new Map<string, AssemblyNode[]>();
    for (const n of this.store.nodes()) {
      if (n.parentId) { const a = m.get(n.parentId) ?? []; a.push(n); m.set(n.parentId, a); }
    }
    return m;
  });
  private descendantGuids(n: AssemblyNode): string[] {
    const out: string[] = [];
    const stack = [n];
    const kids = this.childrenByParent();
    while (stack.length) {
      const cur = stack.pop()!;
      const g = cur.ifcGuid ?? cur.meshName;
      if (g) out.push(g);
      for (const c of kids.get(cur.id) ?? []) stack.push(c);
    }
    return out;
  }

  modelUrl = computed(() => this.store.fullModelUrl());
  referenceLengths = computed<ViewerReferenceLength[]>(() =>
    this.store.nodes()
      .filter((n) => n.ifcGuid && n.lengthMm != null && n.lengthMm > 0)
      .map((n) => ({ meshName: n.ifcGuid as string, lengthMm: n.lengthMm as number })),
  );

  // One status colour per piece (NCR > shipped > on-a-load > ready > in-prod > not).
  statusColor(it: AuditItem): string {
    if (it.openNcrs > 0 || it.shipStatus === 'blocked_ncr') return '#c62828';
    if (it.shipStatus === 'shipped') return '#64748b';
    if (it.shipStatus === 'allocated') return '#1565c0';
    if (it.shipStatus === 'ready') return '#2e7d32';
    if (it.status === 'in_progress') return '#f59e0b';
    return '#9aa7b0';
  }
  statusLabel(it: AuditItem): string {
    if (it.openNcrs > 0 || it.shipStatus === 'blocked_ncr') return 'NCR';
    if (it.shipStatus === 'shipped') return 'Shipped';
    if (it.shipStatus === 'allocated') return 'On a load';
    if (it.shipStatus === 'ready') return 'Ready';
    if (it.status === 'in_progress') return 'In production';
    if (it.status === 'completed') return 'Complete';
    return 'Not started';
  }

  colorOverlay = computed<ViewerColorOverlay | null>(() => {
    const a = this.audit();
    if (!a) return null;
    const byId = this.byId();
    const colors: Record<string, string> = {};
    const n = { ncr: 0, shipped: 0, loaded: 0, ready: 0, prod: 0, not: 0 };
    for (const it of a.items) {
      if (!it.nodeId) continue;
      const node = byId.get(it.nodeId);
      if (!node) continue;
      const c = this.statusColor(it);
      for (const g of this.descendantGuids(node)) colors[g] = c;
      if (it.openNcrs > 0 || it.shipStatus === 'blocked_ncr') n.ncr++;
      else if (it.shipStatus === 'shipped') n.shipped++;
      else if (it.shipStatus === 'allocated') n.loaded++;
      else if (it.shipStatus === 'ready') n.ready++;
      else if (it.status === 'in_progress') n.prod++;
      else n.not++;
    }
    return {
      colors,
      legend: [
        { label: `Not started (${n.not})`, color: '#9aa7b0' },
        { label: `In production (${n.prod})`, color: '#f59e0b' },
        { label: `Ready (${n.ready})`, color: '#2e7d32' },
        { label: `On a load (${n.loaded})`, color: '#1565c0' },
        { label: `Shipped (${n.shipped})`, color: '#64748b' },
        { label: `NCR (${n.ncr})`, color: '#c62828' },
      ],
    };
  });

  hasGeometry = computed(() => {
    const o = this.colorOverlay();
    return !!o && Object.keys(o.colors).length > 0;
  });

  selectedItem = computed<AuditItem | null>(() => {
    const id = this.selectedNodeId();
    const a = this.audit();
    if (!id || !a) return null;
    return a.items.find((it) => it.nodeId === id) ?? null;
  });

  onMeshClicked(name: string): void {
    // Meshes are PARTS, but audit items sit on the bearing ASSEMBLY (one work
    // order per assembly). Walk up to the nearest ancestor that has an item.
    const byId = this.byId();
    const itemIds = new Set((this.audit()?.items ?? []).map((i) => i.nodeId));
    let node: AssemblyNode | null = this.store.nodes().find((n) => n.ifcGuid === name || n.meshName === name) ?? null;
    while (node && !itemIds.has(node.id)) {
      node = node.parentId ? byId.get(node.parentId) ?? null : null;
    }
    this.selectedNodeId.set(node ? node.id : null);
  }
}
