import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ThreeViewerComponent } from '../shared/components/three-viewer/three-viewer.component';
import { ProjectWorkspaceStore } from './project-workspace.store';
import {
  ProjectsService, AssemblyNode, NodeType, NodeProductionStatus,
  QualityEntry, RecordQuality, QaStatus, QaSeverity,
} from '../core/services/projects.service';

/** Assemblies & 3D tab: the assembly tree (left) with a synced 3D viewer (right)
 *  and an inline quality panel for the selected item. Reads the shared store. */
@Component({
  selector: 'app-project-assemblies',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, ThreeViewerComponent],
  template: `
    @if (store.loading() && !store.hasNodes()) {
      <div class="center"><mat-spinner diameter="36"></mat-spinner></div>
    } @else if (!store.hasNodes()) {
      <div class="empty-state">
        <mat-icon>account_tree</mat-icon>
        <h3>No assemblies yet</h3>
        <p>Upload an IFC export (Tekla, Revit, Advance Steel) to extract assemblies, sub-assemblies and parts into the tree.</p>
        <input #fileInput type="file" hidden accept=".ifc" (change)="onFile($event)">
        <button class="cta" (click)="fileInput.click()" [disabled]="store.importing()"><mat-icon>upload_file</mat-icon>{{ store.importing() ? 'Importing…' : 'Import IFC file' }}</button>
      </div>
    } @else {
      <!-- Action bar -->
      <div class="actionbar">
        <div class="route-group">
          <select class="proc-select" [(ngModel)]="selectedProcessId">
            <option value="">Route through process…</option>
            @for (p of store.processes(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
          </select>
          <button class="btn primary" [disabled]="generating() || !selectedProcessId" (click)="generate()">
            <mat-icon>playlist_add</mat-icon>{{ generating() ? 'Generating…' : 'Generate work orders' }}
          </button>
        </div>
        <button class="btn ghost" [disabled]="recomputing()" (click)="recompute()"><mat-icon>sync</mat-icon>{{ recomputing() ? 'Refreshing…' : 'Refresh status' }}</button>
        @if (genMsg()) { <span class="genmsg" [class.err]="genErr()">{{ genMsg() }}</span> }
        <span class="spacer"></span>
        <div class="tree-tools">
          <button class="link-btn" (click)="expandAll()">Expand all</button>
          <span class="sep">·</span>
          <button class="link-btn" (click)="collapseAll()">Collapse all</button>
        </div>
      </div>

      <div class="layout">
        <!-- Tree -->
        <div class="tree-pane">
          <div class="tree">
            @for (n of store.nodes(); track n.id) {
              @if (visible(n)) {
                <div class="node" [class.sel]="selectedGuid() === n.ifcGuid && !!n.ifcGuid" [style.padding-left.px]="10 + n.depth * 18" (click)="onNodeClick(n)">
                  @if (hasChildren(n)) {
                    <button class="caret" (click)="toggle(n); $event.stopPropagation()"><mat-icon>{{ collapsed.has(n.id) ? 'chevron_right' : 'expand_more' }}</mat-icon></button>
                  } @else { <span class="caret-spacer"></span> }
                  <mat-icon class="ntype t-{{ n.nodeType }}">{{ typeIcon(n.nodeType) }}</mat-icon>
                  <span class="nname">{{ n.name }}</span>
                  @if (n.mark) { <span class="mark">{{ n.mark }}</span> }
                  @if (n.quantity > 1) { <span class="qty">×{{ n.quantity }}</span> }
                  @if (n.profile) { <span class="meta">{{ n.profile }}</span> }
                  @if (n.materialGrade) { <span class="meta grade">{{ n.materialGrade }}</span> }
                  @if (n.lengthMm) { <span class="meta">{{ n.lengthMm | number:'1.0-0' }}mm</span> }
                  <span class="spacer"></span>
                  @if (qaDot(n); as qd) { <span class="qa-tdot qb-{{ qd }}" [title]="'Quality: ' + qd"></span> }
                  @if (n.nodeType !== 'group') {
                    @if (n.percentComplete > 0 && n.productionStatus !== 'ready_to_ship' && n.productionStatus !== 'shipped') { <span class="pct">{{ n.percentComplete }}%</span> }
                    <span class="status ps-{{ n.productionStatus }}">{{ statusLabel(n.productionStatus) }}</span>
                  }
                </div>
              }
            }
          </div>
        </div>

        <!-- Viewer + QA -->
        <div class="viewer-pane">
          @if (modelUrl(); as url) {
            <div class="viewer-tools">
              <span class="vt-hint">{{ isolate() ? 'Isolated view' : 'Click a part to highlight' }}</span>
              <button type="button" class="iso-btn" [class.on]="isolate()" [disabled]="!isolate() && !canIsolate()" (click)="toggleIsolate()">
                <mat-icon>{{ isolate() ? 'fullscreen' : 'filter_center_focus' }}</mat-icon>{{ isolate() ? 'Show full model' : 'Isolate selected' }}
              </button>
            </div>
            <div class="viewer-box"><app-three-viewer [modelUrl]="url" [highlightNames]="isolate() ? [] : highlightGuids()" (meshClicked)="onMeshClicked($event)"></app-three-viewer></div>
          } @else {
            <div class="noviewer">
              <mat-icon>view_in_ar</mat-icon>
              @if (store.modelPending()) { <p>3D model is converting in the background. It'll appear here shortly.</p> }
              @else { <p>No 3D model for this project yet.</p> }
            </div>
          }

          @if (selectedNodeId()) {
            <div class="qa">
              <div class="qa-head">
                <mat-icon class="qa-ico">verified</mat-icon>
                <span class="qa-title">{{ selectedNodeName() }}</span>
                @if (qaNodeStatus(); as qs) { <span class="qa-badge qb-{{ qs }}">{{ qs }}</span> }
                @if (qaNodeOpenNcr() > 0) { <span class="qa-badge qb-fail">{{ qaNodeOpenNcr() }} NCR</span> }
              </div>
              <div class="qa-actions">
                <button class="qbtn pass" (click)="recordQuick('pass')" [disabled]="qaBusy()">Pass</button>
                <button class="qbtn warn" (click)="recordQuick('warning')" [disabled]="qaBusy()">Warning</button>
                <button class="qbtn fail" (click)="recordQuick('fail')" [disabled]="qaBusy()">Fail</button>
                <button class="qbtn" (click)="qaMeasureOpen.set(!qaMeasureOpen()); qaNcrOpen.set(false)">Measure…</button>
                <button class="qbtn ncr" (click)="openNcr()">Raise NCR</button>
              </div>

              @if (qaMeasureOpen()) {
                <div class="qa-form">
                  <input type="number" placeholder="Value" [(ngModel)]="meas.value" />
                  <input type="text" placeholder="Unit" [(ngModel)]="meas.unit" />
                  <input type="number" placeholder="Tol min" [(ngModel)]="meas.min" />
                  <input type="number" placeholder="Tol max" [(ngModel)]="meas.max" />
                  <input class="grow" type="text" placeholder="Defect / notes" [(ngModel)]="meas.notes" />
                  <div class="qa-form-row">
                    <button class="qbtn measure" (click)="recordMeasure()" [disabled]="qaBusy() || meas.value == null">Save measurement</button>
                    <span class="qa-hint">Out-of-tolerance auto-fails.</span>
                  </div>
                </div>
              }
              @if (qaNcrOpen()) {
                <div class="qa-form">
                  <input class="grow" type="text" placeholder="Title" [(ngModel)]="ncr.title" />
                  <select [(ngModel)]="ncr.severity"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="critical">critical</option></select>
                  <textarea placeholder="Description (optional)" [(ngModel)]="ncr.description"></textarea>
                  <div class="qa-form-row">
                    <button class="qbtn ncr" (click)="submitNcr()" [disabled]="qaBusy()">Raise NCR</button>
                    <button class="qbtn" (click)="qaNcrOpen.set(false)">Cancel</button>
                  </div>
                </div>
              }
              @if (qaMsg()) { <p class="qa-msg" [class.err]="qaErr()">{{ qaMsg() }}</p> }

              @if (qaLoading()) { <p class="qa-hint">Loading inspections…</p> }
              @else if (qaList().length === 0) { <p class="qa-hint">No inspections yet for this item.</p> }
              @else {
                <div class="qa-list">
                  @for (q of qaList(); track q.id) {
                    <div class="qa-item">
                      <span class="qa-dot qb-{{ q.status }}"></span>
                      <span class="qa-st">{{ q.status }}</span>
                      @if (q.measurementValue != null) { <span class="qa-meta">{{ q.measurementValue }}{{ q.measurementUnit }}</span> }
                      @if (q.defectType) { <span class="qa-meta">{{ q.defectType }}</span> }
                      <span class="spacer"></span>
                      @if (q.status === 'fail') { <button class="qlink" (click)="openNcrFor(q)">NCR</button> }
                      <span class="qa-when">{{ q.createdAt | date:'MMM d' }}</span>
                    </div>
                  }
                </div>
              }
            </div>
          } @else {
            <p class="select-hint"><mat-icon>touch_app</mat-icon>Select an item in the tree to inspect it and record quality.</p>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .center { display: flex; justify-content: center; padding: 56px 0; }
    .cta { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; background: var(--clay-primary); color: #fff; padding: 10px 18px; border-radius: var(--clay-radius-sm); font-size: 13px; font-weight: 600; border: none; cursor: pointer; }
    .cta mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .cta:disabled { opacity: .6; cursor: default; }

    /* Action bar */
    .actionbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
    .route-group { display: flex; align-items: center; gap: 8px; }
    .proc-select { padding: 8px 12px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); background: var(--clay-surface); color: var(--clay-text); font-size: 13px; font-family: inherit; }
    .btn { display: inline-flex; align-items: center; gap: 6px; border-radius: var(--clay-radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; border: 1px solid var(--clay-border); transition: all .15s; }
    .btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .btn.primary { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
    .btn.primary:hover:not(:disabled) { filter: brightness(1.08); }
    .btn.ghost { background: var(--clay-surface); color: var(--clay-text-secondary); }
    .btn.ghost:hover:not(:disabled) { border-color: var(--clay-primary); color: var(--clay-primary); }
    .btn:disabled { opacity: .5; cursor: default; }
    .genmsg { font-size: 12px; color: var(--success-text); font-weight: 600; }
    .genmsg.err { color: var(--danger-text); }
    .spacer { flex: 1; }
    .tree-tools { font-size: 12px; color: var(--clay-text-muted); }
    .link-btn { background: none; border: none; color: var(--clay-primary); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; padding: 0; }
    .tree-tools .sep { margin: 0 4px; }

    .layout { display: flex; gap: 16px; align-items: flex-start; }
    .tree-pane { flex: 1; min-width: 0; }
    .tree { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); overflow: hidden; box-shadow: var(--clay-shadow-soft); }
    .node { display: flex; align-items: center; gap: 8px; padding: 7px 14px 7px 10px; border-bottom: 1px solid var(--clay-border); font-size: 13px; cursor: pointer; transition: background .12s; }
    .node:last-child { border-bottom: none; }
    .node:hover { background: var(--clay-surface-hover); }
    .node.sel { background: var(--info-bg); box-shadow: inset 3px 0 0 var(--clay-primary); }
    .caret { background: none; border: none; cursor: pointer; padding: 0; display: flex; color: var(--clay-text-muted); }
    .caret mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .caret-spacer { width: 20px; display: inline-block; flex-shrink: 0; }
    .ntype { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .t-group { color: var(--clay-text-muted); } .t-assembly { color: var(--clay-primary); }
    .t-subassembly { color: var(--kpi-purple-fg); } .t-part { color: var(--clay-text-secondary); }
    .nname { font-weight: 500; color: var(--clay-text); white-space: nowrap; }
    .mark { background: var(--clay-bg-warm); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); padding: 0 6px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); font-family: 'Space Grotesk', monospace; }
    .qty { color: var(--clay-text-muted); font-size: 12px; }
    .meta { color: var(--clay-text-muted); font-size: 12px; white-space: nowrap; } .meta.grade { color: var(--success-text); }
    .spacer { flex: 1; }
    .status { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap; }
    .ps-not_started { background: var(--badge-draft-bg); color: var(--badge-draft-text); }
    .ps-in_progress { background: var(--warning-bg); color: var(--warning-text); }
    .ps-ready_to_ship { background: var(--success-bg); color: var(--success-text); }
    .ps-shipped { background: var(--badge-progress-bg); color: var(--badge-progress-text); }
    .ps-on_hold { background: var(--danger-bg); color: var(--danger-text); }
    .pct { color: var(--clay-text-muted); font-size: 11px; font-weight: 600; min-width: 30px; text-align: right; }

    /* Viewer */
    .viewer-pane { width: 480px; flex-shrink: 0; position: sticky; top: 200px; }
    .viewer-tools { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .vt-hint { font-size: 12px; color: var(--clay-text-muted); }
    .viewer-box { height: 460px; }
    .viewer-box app-three-viewer { display: block; height: 100%; }
    .iso-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--clay-primary); background: var(--clay-surface); color: var(--clay-primary); border-radius: var(--clay-radius-sm); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .iso-btn:hover:not(:disabled) { background: var(--info-bg); }
    .iso-btn.on { background: var(--clay-primary); color: #fff; }
    .iso-btn:disabled { opacity: .5; cursor: default; border-color: var(--clay-border); color: var(--clay-text-muted); }
    .iso-btn mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .noviewer { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 16px; color: var(--clay-text-muted); background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); text-align: center; height: 460px; justify-content: center; }
    .noviewer mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .select-hint { display: flex; align-items: center; gap: 6px; margin-top: 12px; color: var(--clay-text-muted); font-size: 13px; }
    .select-hint mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* QA */
    .qa { margin-top: 12px; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 14px; }
    .qa-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .qa-ico { color: var(--clay-primary); font-size: 20px; width: 20px; height: 20px; }
    .qa-title { font-weight: 600; font-size: 14px; color: var(--clay-text); flex: 1; }
    .qa-badge { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: capitalize; color: #fff; }
    .qa-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .qbtn { border: 1px solid var(--clay-border); background: var(--clay-surface); border-radius: var(--clay-radius-sm); padding: 6px 11px; font-size: 12px; font-weight: 600; cursor: pointer; color: var(--clay-text-secondary); font-family: inherit; transition: all .15s; }
    .qbtn:hover:not(:disabled) { background: var(--clay-surface-hover); }
    .qbtn:disabled { opacity: .5; cursor: default; }
    .qbtn.pass { color: var(--success-text); border-color: var(--success); }
    .qbtn.warn { color: var(--warning-text); border-color: var(--warning); }
    .qbtn.fail { color: var(--danger-text); border-color: var(--danger); }
    .qbtn.ncr { color: var(--clay-primary); border-color: var(--clay-primary); }
    .qa-form { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; padding: 10px; background: var(--clay-bg-warm); border-radius: var(--clay-radius-sm); }
    .qa-form input, .qa-form select, .qa-form textarea { padding: 6px 8px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); font-size: 12px; background: var(--clay-surface); color: var(--clay-text); font-family: inherit; }
    .qa-form input[type=number] { width: 84px; }
    .qa-form .grow { flex: 1; min-width: 140px; }
    .qa-form textarea { width: 100%; min-height: 46px; }
    .qa-form-row { display: flex; align-items: center; gap: 8px; width: 100%; }
    .qa-hint { color: var(--clay-text-muted); font-size: 12px; margin: 4px 0; }
    .qa-msg { color: var(--success-text); font-size: 12px; margin: 4px 0; font-weight: 600; }
    .qa-msg.err { color: var(--danger-text); }
    .qa-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .qa-item { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 7px 9px; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); }
    .qa-dot, .qa-tdot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .qa-tdot { margin-right: 2px; }
    .qa-st { text-transform: capitalize; color: var(--clay-text-secondary); }
    .qa-meta { color: var(--clay-text-muted); }
    .qa-when { color: var(--clay-text-muted); font-size: 11px; }
    .qlink { background: none; border: none; color: var(--clay-primary); font-weight: 600; cursor: pointer; font-size: 12px; font-family: inherit; }
    .qb-pass { background: var(--success); } .qb-warning { background: var(--warning); } .qb-fail { background: var(--danger); }

    @media (max-width: 960px) { .layout { flex-direction: column; } .viewer-pane { width: 100%; position: static; } }
  `],
})
export class ProjectAssembliesComponent implements OnInit {
  store = inject(ProjectWorkspaceStore);
  private svc = inject(ProjectsService);
  private route = inject(ActivatedRoute);

  // Derived tree indexes (reactive to store.nodes()).
  private byId = computed(() => new Map(this.store.nodes().map((n) => [n.id, n])));
  private childrenByParent = computed(() => {
    const m = new Map<string, AssemblyNode[]>();
    for (const n of this.store.nodes()) {
      if (n.parentId) { const arr = m.get(n.parentId) ?? []; arr.push(n); m.set(n.parentId, arr); }
    }
    return m;
  });

  collapsed = new Set<string>();
  selectedGuid = signal<string | null>(null);
  selectedNodeId = signal<string | null>(null);
  highlightGuids = signal<string[]>([]);
  isolate = signal(false);

  selectedProcessId = '';
  generating = signal(false);
  recomputing = signal(false);
  genMsg = signal<string | null>(null);
  genErr = signal(false);

  // Quality (selected node)
  qaList = signal<QualityEntry[]>([]);
  qaLoading = signal(false);
  qaBusy = signal(false);
  qaMsg = signal<string | null>(null);
  qaErr = signal(false);
  qaMeasureOpen = signal(false);
  qaNcrOpen = signal(false);
  meas: { value: number | null; unit: string; min: number | null; max: number | null; notes: string } = { value: null, unit: 'mm', min: null, max: null, notes: '' };
  ncr: { title: string; severity: QaSeverity; description: string; qualityDataId?: string } = { title: '', severity: 'medium', description: '' };

  private pendingFocus: string | null = null;
  private focusApplied = false;
  private procDefaulted = false;

  constructor() {
    // Default the routing select to the project's process; apply a ?focus=<nodeId> deep-link once nodes load.
    effect(() => {
      const nodes = this.store.nodes();
      const proj = this.store.project();
      if (!this.procDefaulted && proj?.processId) { this.selectedProcessId = proj.processId; this.procDefaulted = true; }
      if (!this.focusApplied && this.pendingFocus && nodes.length) {
        const node = nodes.find((n) => n.id === this.pendingFocus);
        if (node) { this.select(node); this.focusApplied = true; }
      }
    });
  }

  ngOnInit(): void {
    this.pendingFocus = this.route.snapshot.queryParamMap.get('focus');
  }

  // ── Tree ──
  hasChildren(n: AssemblyNode): boolean { return (this.childrenByParent().get(n.id)?.length ?? 0) > 0; }
  visible(n: AssemblyNode): boolean {
    let p = n.parentId;
    const byId = this.byId();
    while (p) { if (this.collapsed.has(p)) return false; p = byId.get(p)?.parentId ?? null; }
    return true;
  }
  toggle(n: AssemblyNode): void { this.collapsed.has(n.id) ? this.collapsed.delete(n.id) : this.collapsed.add(n.id); }
  expandAll(): void { this.collapsed.clear(); }
  collapseAll(): void { this.collapsed = new Set(this.store.nodes().filter((n) => this.hasChildren(n)).map((n) => n.id)); }

  onNodeClick(n: AssemblyNode): void { this.select(n); }
  private select(n: AssemblyNode): void {
    this.selectedGuid.set(n.ifcGuid);
    this.selectedNodeId.set(n.id);
    this.highlightGuids.set(this.descendantGuids(n));
    this.isolate.set(false);
    this.loadNodeQuality();
  }
  onMeshClicked(name: string): void {
    this.selectedGuid.set(name);
    this.highlightGuids.set([name]);
    const node = this.store.nodes().find((n) => n.ifcGuid === name);
    if (node) {
      this.selectedNodeId.set(node.id);
      let p = node.parentId; const byId = this.byId();
      while (p) { this.collapsed.delete(p); p = byId.get(p)?.parentId ?? null; }
      this.loadNodeQuality();
    }
  }
  private descendantGuids(n: AssemblyNode): string[] {
    const out: string[] = []; const stack = [n]; const kids = this.childrenByParent();
    while (stack.length) { const cur = stack.pop()!; if (cur.ifcGuid) out.push(cur.ifcGuid); for (const c of (kids.get(cur.id) ?? [])) stack.push(c); }
    return out;
  }

  // ── 3D viewer ──
  modelUrl(): string | null {
    const id = this.selectedNodeId();
    const sel = id ? this.byId().get(id) : null;
    if (this.isolate() && sel?.modelId) return this.svc.nodeGlbUrl(this.store.id(), sel.id);
    return this.store.fullModelUrl();
  }
  canIsolate(): boolean {
    const id = this.selectedNodeId();
    return !!(id && this.byId().get(id)?.modelId);
  }
  toggleIsolate(): void { if (this.isolate() || this.canIsolate()) this.isolate.set(!this.isolate()); }

  // ── Work orders ──
  generate(): void {
    if (!this.selectedProcessId) return;
    this.generating.set(true); this.genMsg.set(null); this.genErr.set(false);
    this.svc.generateWorkOrders(this.store.id(), this.selectedProcessId).subscribe({
      next: (r) => { this.generating.set(false); this.genMsg.set(`Created ${r.created} work orders (${r.skipped} already existed).`); this.store.recompute(); },
      error: (e) => { this.generating.set(false); this.genErr.set(true); this.genMsg.set(e?.error?.message || 'Generation failed'); },
    });
  }
  recompute(): void {
    this.recomputing.set(true);
    this.store.recompute().subscribe({ next: () => this.recomputing.set(false), error: () => this.recomputing.set(false) });
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length ? input.files[0] : null;
    if (file) this.store.importIfc(file);
    input.value = '';
  }

  // ── Quality ──
  selectedNodeName(): string {
    const id = this.selectedNodeId(); const s = id ? this.byId().get(id) : null;
    return s ? (s.mark || s.name) : '';
  }
  qaNodeStatus(): QaStatus | null { const id = this.selectedNodeId(); return id ? (this.store.quality()?.nodes[id]?.status ?? null) : null; }
  qaNodeOpenNcr(): number { const id = this.selectedNodeId(); return id ? (this.store.quality()?.nodes[id]?.openNcr ?? 0) : 0; }
  qaDot(n: AssemblyNode): QaStatus | null {
    const e = this.store.quality()?.nodes[n.id];
    if (!e) return null;
    return e.status ?? (e.openNcr > 0 ? 'fail' : null);
  }
  private loadNodeQuality(): void {
    this.qaMeasureOpen.set(false); this.qaNcrOpen.set(false); this.qaMsg.set(null);
    const id = this.selectedNodeId();
    if (!id) { this.qaList.set([]); return; }
    this.qaLoading.set(true);
    this.svc.nodeQuality(this.store.id(), id).subscribe({
      next: (l) => { this.qaList.set(l); this.qaLoading.set(false); },
      error: () => { this.qaList.set([]); this.qaLoading.set(false); },
    });
  }
  recordQuick(status: QaStatus): void {
    const id = this.selectedNodeId(); if (!id || this.qaBusy()) return;
    this.qaBusy.set(true); this.qaMsg.set(null); this.qaErr.set(false);
    this.svc.recordQuality(this.store.id(), id, { status }).subscribe({
      next: () => { this.qaBusy.set(false); this.qaMsg.set('Recorded: ' + status); this.loadNodeQuality(); this.store.refreshQuality(); },
      error: (e) => { this.qaBusy.set(false); this.qaErr.set(true); this.qaMsg.set(e?.error?.message || 'Could not record.'); },
    });
  }
  recordMeasure(): void {
    const id = this.selectedNodeId(); if (!id || this.meas.value == null || this.qaBusy()) return;
    this.qaBusy.set(true); this.qaMsg.set(null); this.qaErr.set(false);
    const body: RecordQuality = {
      status: 'pass', measurementValue: this.meas.value, measurementUnit: this.meas.unit || undefined,
      toleranceMin: this.meas.min ?? undefined, toleranceMax: this.meas.max ?? undefined, notes: this.meas.notes || undefined,
    };
    this.svc.recordQuality(this.store.id(), id, body).subscribe({
      next: (q) => {
        this.qaBusy.set(false); this.qaMeasureOpen.set(false);
        this.meas = { value: null, unit: 'mm', min: null, max: null, notes: '' };
        this.qaMsg.set('Recorded ' + q.status + (q.measurementValue != null ? ' (' + q.measurementValue + (q.measurementUnit || '') + ')' : ''));
        this.loadNodeQuality(); this.store.refreshQuality();
      },
      error: (e) => { this.qaBusy.set(false); this.qaErr.set(true); this.qaMsg.set(e?.error?.message || 'Could not record.'); },
    });
  }
  openNcr(): void {
    const id = this.selectedNodeId(); const s = id ? this.byId().get(id) : null;
    this.ncr = { title: s ? (s.mark || s.name) + ' — quality non-conformance' : 'Quality non-conformance', severity: 'medium', description: '', qualityDataId: undefined };
    this.qaNcrOpen.set(true); this.qaMeasureOpen.set(false); this.qaMsg.set(null);
  }
  openNcrFor(q: QualityEntry): void {
    const id = this.selectedNodeId(); const s = id ? this.byId().get(id) : null;
    this.ncr = { title: (s ? (s.mark || s.name) : 'Item') + ' — ' + (q.defectType || 'failed inspection'), severity: (q.severity as QaSeverity) || 'medium', description: q.notes || '', qualityDataId: q.id };
    this.qaNcrOpen.set(true); this.qaMeasureOpen.set(false); this.qaMsg.set(null);
  }
  submitNcr(): void {
    const id = this.selectedNodeId(); if (!id || this.qaBusy()) return;
    this.qaBusy.set(true); this.qaMsg.set(null); this.qaErr.set(false);
    this.svc.raiseNodeNcr(this.store.id(), id, { title: this.ncr.title || undefined, severity: this.ncr.severity, description: this.ncr.description || undefined, qualityDataId: this.ncr.qualityDataId }).subscribe({
      next: (n) => { this.qaBusy.set(false); this.qaNcrOpen.set(false); this.qaMsg.set('Raised ' + n.number); this.store.refreshQuality(); },
      error: (e) => { this.qaBusy.set(false); this.qaErr.set(true); this.qaMsg.set(e?.error?.message || 'Could not raise NCR.'); },
    });
  }

  typeIcon(t: NodeType): string { return { group: 'folder', assembly: 'widgets', subassembly: 'account_tree', part: 'square_foot' }[t] ?? 'circle'; }
  statusLabel(s: NodeProductionStatus): string {
    return { not_started: 'Not started', in_progress: 'In progress', ready_to_ship: 'Ready to ship', shipped: 'Shipped', on_hold: 'On hold' }[s] ?? s;
  }
}
