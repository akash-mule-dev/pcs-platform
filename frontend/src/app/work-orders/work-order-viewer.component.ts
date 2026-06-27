import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ThreeViewerComponent, ViewerReferenceLength, ViewerColorOverlay } from '../shared/components/three-viewer/three-viewer.component';
import { ProjectsService, AssemblyNode, AuditItem, OrderAudit } from '../core/services/projects.service';

/**
 * Per-WORK-ORDER 3D viewer — the web twin of the mobile "3D Viewer" tile
 * (PartViewerScreen). A work order targets one assembly node; this shows ONLY
 * that assembly, isolated server-side via the per-node GLB
 * (`/projects/:id/nodes/:nodeId/glb`). Tools: orbit + measure/dimensions (real
 * mm, calibrated from known part lengths), colour-by profile/grade, solid/x-ray,
 * and click-a-part to read its design facts.
 *
 * Route: /work-orders/:id/3d?node=<assemblyNodeId>  (`:id` = production order id).
 * The order-LEVEL status viewer (every piece coloured by status) already lives
 * at projects/:id/orders/:orderId/3d (OrderViewerComponent) — this is the
 * single-piece counterpart, reachable from the work-order audit page.
 */
@Component({
  selector: 'app-work-order-viewer',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatIconModule, MatProgressSpinnerModule, ThreeViewerComponent],
  template: `
    <div class="wov">
      <div class="head">
        <a class="back" [routerLink]="['/work-orders', orderId]" title="Back to the work order">
          <mat-icon>arrow_back</mat-icon>
        </a>
        <div class="title">
          <h1>{{ headerMark() }}</h1>
          @if (item(); as it) {
            <span class="ss ss-{{ it.status }}">{{ statusLabel(it.status) }}</span>
            @if (it.openNcrs > 0) { <span class="chip ncr"><mat-icon>report_problem</mat-icon>{{ it.openNcrs }} NCR</span> }
          }
          @if (woNumber()) { <span class="wonum mono">{{ woNumber() }}</span> }
        </div>

        @if (hasGeometry()) {
          <div class="controls">
            <label class="color-by" title="Colour the model by a property">
              <mat-icon>palette</mat-icon>
              <select [ngModel]="colorMode()" (ngModelChange)="colorMode.set($event)">
                <option value="none">No colouring</option>
                <option value="profile">By profile</option>
                <option value="grade">By grade</option>
              </select>
            </label>
            <button type="button" class="tgl" [class.on]="xray()" (click)="xray.set(!xray())" title="Toggle x-ray / solid">
              <mat-icon>{{ xray() ? 'visibility' : 'blur_on' }}</mat-icon>{{ xray() ? 'Solid' : 'X-ray' }}
            </button>
          </div>
        }
      </div>

      @if (loading()) {
        <div class="center"><mat-spinner diameter="34"></mat-spinner></div>
      } @else if (!modelUrl()) {
        <div class="empty">
          <mat-icon>view_in_ar</mat-icon>
          <p>This work order isn't linked to a 3D model. Once the project model finishes converting, the piece appears here.</p>
        </div>
      } @else if (!hasGeometry()) {
        <div class="empty">
          <mat-icon>view_in_ar</mat-icon>
          <p>This piece has no 3D geometry (it came from a geometry-less import). Nothing to show in 3D.</p>
        </div>
      } @else {
        <div class="stage">
          <div class="viewer-box">
            <app-three-viewer
              [modelUrl]="modelUrl()"
              [colorOverlay]="colorOverlay()"
              [referenceLengths]="referenceLengths()"
              [renderMode]="xray() ? 'xray' : 'solid'"
              [autoFocus]="true"
              [showTools]="true"
              (meshClicked)="onMeshClicked($event)"></app-three-viewer>
          </div>

          @if (selectedPart(); as p) {
            <aside class="detail">
              <div class="d-head">
                <strong>{{ displayName(p) }}</strong>
                @if (p.mark) { <span class="mark">{{ p.mark }}</span> }
                <button class="x" (click)="selectedPart.set(null)" title="Close"><mat-icon>close</mat-icon></button>
              </div>
              <div class="facts">
                @if (defined(p.profile); as v) { <div><label>Profile</label><span>{{ v }}</span></div> }
                @if (defined(p.materialGrade); as v) { <div><label>Grade</label><span>{{ v }}</span></div> }
                @if (p.lengthMm != null) { <div><label>Length</label><span>{{ p.lengthMm | number:'1.0-0' }} mm</span></div> }
                @if (p.weightKg != null) { <div><label>Weight</label><span>{{ p.weightKg | number:'1.0-1' }} kg</span></div> }
                @if (p.quantity > 1) { <div><label>Qty</label><span>{{ p.quantity }}</span></div> }
              </div>
            </aside>
          } @else {
            <aside class="detail hint">
              <mat-icon>touch_app</mat-icon>
              <p>Click a member to read its profile, grade and measurements. Use the toolbar to measure distances and dimensions in mm.</p>
            </aside>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .wov { max-width: 1280px; margin: 0 auto; }
    .head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
    .back { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: var(--clay-radius-sm); border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); flex-shrink: 0; }
    .back:hover { border-color: var(--clay-primary); color: var(--clay-primary); }
    .back mat-icon { font-size: 19px; width: 19px; height: 19px; }
    .title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
    .title h1 { margin: 0; font-size: 19px; font-weight: 700; color: var(--clay-text); }
    .ss { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 9px; text-transform: capitalize; }
    .ss-not_started { background: var(--clay-bg-warm); color: var(--clay-text-muted); }
    .ss-in_progress { background: var(--warning-bg, #fef3c7); color: var(--warning-text, #92400e); }
    .ss-completed { background: var(--success-bg, #dcfce7); color: var(--success-text, #166534); }
    .chip { display: inline-flex; align-items: center; gap: 4px; color: #fff; border-radius: 999px; padding: 2px 9px; font-size: 11px; font-weight: 700; }
    .chip.ncr { background: var(--danger-text, #c62828); }
    .chip mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .wonum { font-size: 12px; color: var(--clay-text-muted); font-weight: 600; }
    .mono { font-family: 'Space Grotesk', monospace; }
    .controls { display: flex; align-items: center; gap: 10px; margin-left: auto; }
    .color-by { display: inline-flex; align-items: center; gap: 5px; color: var(--clay-text-secondary); }
    .color-by mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); }
    .color-by select { border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); background: var(--clay-surface); color: var(--clay-text); padding: 5px 8px; font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer; }
    .tgl { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); border-radius: var(--clay-radius-sm); padding: 6px 11px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .tgl.on { border-color: var(--clay-primary); color: var(--clay-primary); background: var(--info-bg); }
    .tgl mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .center, .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 56px 24px; color: var(--clay-text-muted); text-align: center; }
    .empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .empty p { max-width: 440px; font-size: 14px; line-height: 1.5; }

    .stage { display: flex; gap: 14px; align-items: stretch; }
    .viewer-box { flex: 1; min-width: 0; height: min(74vh, 700px); border-radius: 12px; overflow: hidden; border: 1px solid var(--clay-border); background: #eaf4fc; }
    .viewer-box app-three-viewer { display: block; height: 100%; }
    .detail { flex: 0 0 260px; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); box-shadow: var(--clay-shadow-soft); padding: 12px 14px; align-self: flex-start; }
    .detail.hint { display: flex; flex-direction: column; gap: 8px; color: var(--clay-text-muted); }
    .detail.hint mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .detail.hint p { margin: 0; font-size: 12.5px; line-height: 1.5; }
    .d-head { display: flex; align-items: center; gap: 8px; }
    .d-head strong { font-size: 14px; color: var(--clay-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mark { background: var(--clay-bg-warm); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); padding: 0 6px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); font-family: 'Space Grotesk', monospace; }
    .x { margin-left: auto; background: none; border: none; color: var(--clay-text-muted); cursor: pointer; display: flex; padding: 2px; }
    .x:hover { color: var(--danger-text); }
    .x mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .facts { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .facts > div { display: flex; flex-direction: column; gap: 1px; }
    .facts label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); }
    .facts span { font-size: 13px; font-weight: 600; color: var(--clay-text); font-family: 'Space Grotesk', 'Inter', sans-serif; }

    @media (max-width: 880px) {
      .stage { flex-direction: column; }
      .viewer-box { height: 60vh; }
      .detail { flex: none; width: 100%; }
    }
  `],
})
export class WorkOrderViewerComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private svc = inject(ProjectsService);
  @ViewChild(ThreeViewerComponent) private viewer?: ThreeViewerComponent;

  orderId = '';
  nodeId = '';
  private projectId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly audit = signal<OrderAudit | null>(null);
  /** The selected node + all its descendants (what the isolated GLB contains). */
  private subtree = signal<AssemblyNode[]>([]);

  // Default to PROFILE so members read by section on open (recolours once the
  // subtree loads); switch to Grade / None in the picker.
  readonly colorMode = signal<'none' | 'profile' | 'grade'>('profile');
  readonly xray = signal(false);
  readonly selectedPart = signal<AssemblyNode | null>(null);

  private readonly PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#86bcb6', '#d37295'];

  ngOnInit(): void {
    this.orderId = this.route.snapshot.paramMap.get('id') ?? '';
    this.nodeId = this.route.snapshot.queryParamMap.get('node') ?? '';
    if (!this.orderId || !this.nodeId) { this.loading.set(false); return; }

    this.svc.orderAudit(this.orderId).subscribe({
      next: (a) => {
        this.audit.set(a);
        const pid = a.project?.id ?? null;
        this.projectId.set(pid);
        if (!pid) { this.loading.set(false); return; }
        this.svc.nodes(pid).subscribe({
          next: (nodes) => { this.subtree.set(this.collectSubtree(nodes, this.nodeId)); this.loading.set(false); },
          error: () => this.loading.set(false),
        });
      },
      error: () => this.loading.set(false),
    });
  }

  /** The node with id===rootId plus every descendant (depth-first). */
  private collectSubtree(nodes: AssemblyNode[], rootId: string): AssemblyNode[] {
    const childrenByParent = new Map<string, AssemblyNode[]>();
    for (const n of nodes) {
      if (n.parentId) { const arr = childrenByParent.get(n.parentId) ?? []; arr.push(n); childrenByParent.set(n.parentId, arr); }
    }
    const root = nodes.find((n) => n.id === rootId);
    if (!root) return [];
    const out: AssemblyNode[] = [];
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop()!;
      out.push(cur);
      for (const c of childrenByParent.get(cur.id) ?? []) stack.push(c);
    }
    return out;
  }

  /** Isolated single-node GLB (server-carved), fed straight to the viewer. */
  modelUrl = computed(() => {
    const pid = this.projectId();
    return pid && this.nodeId ? this.svc.nodeGlbUrl(pid, this.nodeId) : null;
  });

  /** Any mesh geometry in the subtree? (join key is ifcGuid == GLB mesh name.) */
  hasGeometry = computed(() => this.subtree().some((n) => !!(n.ifcGuid || n.meshName)));

  /** The work order's audit row (for the header chips), if this node is on the order. */
  item = computed<AuditItem | null>(() => this.audit()?.items.find((i) => i.nodeId === this.nodeId) ?? null);
  woNumber = computed(() => this.item()?.workOrderNumber ?? '');
  headerMark = computed(() => this.item()?.mark || this.subtree()[0]?.mark || this.subtree()[0]?.name || '3D view');

  referenceLengths = computed<ViewerReferenceLength[]>(() =>
    this.subtree()
      .filter((n) => (n.ifcGuid || n.meshName) && n.lengthMm != null && n.lengthMm > 0)
      .map((n) => ({ meshName: (n.ifcGuid ?? n.meshName) as string, lengthMm: n.lengthMm as number })),
  );

  /** Colour-by profile / grade over the subtree (most common → stable colours). */
  colorOverlay = computed<ViewerColorOverlay | null>(() => {
    const mode = this.colorMode();
    if (mode === 'none') return null;
    const nodes = this.subtree();
    const keyOf = (n: AssemblyNode) => this.defined(mode === 'profile' ? n.profile : n.materialGrade);
    const counts = new Map<string, number>();
    for (const n of nodes) {
      if (!(n.ifcGuid || n.meshName)) continue;
      const k = keyOf(n);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const distinct = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const MAX = this.PALETTE.length - 1;
    const OTHER = '#9aa0a6';
    const colorByKey = new Map<string, string>();
    distinct.forEach((k, i) => colorByKey.set(k, i < MAX ? this.PALETTE[i] : OTHER));
    const colors: Record<string, string> = {};
    for (const n of nodes) {
      const g = n.ifcGuid ?? n.meshName;
      if (!g) continue;
      const k = keyOf(n);
      if (k) colors[g] = colorByKey.get(k) as string;
    }
    const legend = distinct.slice(0, MAX).map((k) => ({ label: k, color: colorByKey.get(k) as string }));
    if (distinct.length > MAX) legend.push({ label: `Other (${distinct.length - MAX})`, color: OTHER });
    return { colors, legend };
  });

  onMeshClicked(name: string): void {
    const n = this.subtree().find((x) => x.ifcGuid === name || x.meshName === name) ?? null;
    this.selectedPart.set(n);
  }

  statusLabel(status: string): string {
    return { not_started: 'Not started', in_progress: 'In production', completed: 'Complete' }[status] ?? status;
  }

  displayName(n: AssemblyNode): string {
    const name = (n.name ?? '').trim();
    return name && name.toLowerCase() !== 'undefined' ? name : (n.mark || `Unnamed ${n.nodeType}`);
  }

  /** IFC exporters write the literal "Undefined" for missing values — hide it. */
  defined(v: string | null): string | null {
    const t = (v ?? '').trim();
    return t && t.toLowerCase() !== 'undefined' ? t : null;
  }
}
