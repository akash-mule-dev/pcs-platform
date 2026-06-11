import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ThreeViewerComponent } from '../shared/components/three-viewer/three-viewer.component';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { ProjectsService, AssemblyNode, NodeType } from '../core/services/projects.service';

/** Assemblies & 3D tab: the assembly tree (left) with a synced 3D viewer (right).
 *  Pure design view — production tracking and quality live inside each work order. */
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
        <div class="tree-search">
          <mat-icon>search</mat-icon>
          <input type="text" placeholder="Search mark, name or profile…" [(ngModel)]="treeQuery">
          @if (treeQuery) { <button class="clear" (click)="treeQuery = ''">×</button> }
        </div>
        <span class="spacer"></span>
        <div class="tree-tools">
          <button class="link-btn" (click)="expandAll()">Expand all</button>
          <span class="sep">·</span>
          <button class="link-btn" (click)="collapseAll()">Collapse all</button>
        </div>
      </div>
      @if (treeQuery) { <p class="search-info">{{ matchCount() }} matching item(s) — showing as a flat list.</p> }

      <div class="layout">
        <!-- Tree -->
        <div class="tree-pane">
          <div class="tree">
            @for (n of store.nodes(); track n.id) {
              @if (treeQuery ? matches(n) : visible(n)) {
                <div class="node" [class.sel]="selectedGuid() === n.ifcGuid && !!n.ifcGuid" [style.padding-left.px]="treeQuery ? 10 : 10 + n.depth * 18" (click)="onNodeClick(n)">
                  @if (!treeQuery && hasChildren(n)) {
                    <button class="caret" (click)="toggle(n); $event.stopPropagation()"><mat-icon>{{ collapsed.has(n.id) ? 'chevron_right' : 'expand_more' }}</mat-icon></button>
                  } @else { <span class="caret-spacer"></span> }
                  <mat-icon class="ntype t-{{ n.nodeType }}">{{ typeIcon(n.nodeType) }}</mat-icon>
                  <span class="nname">{{ displayName(n) }}</span>
                  @if (n.mark) { <span class="mark">{{ n.mark }}</span> }
                  @if (n.quantity > 1) { <span class="qty">×{{ n.quantity }}</span> }
                  @if (n.profile) { <span class="meta">{{ n.profile }}</span> }
                  @if (n.materialGrade) { <span class="meta grade">{{ n.materialGrade }}</span> }
                  @if (n.lengthMm) { <span class="meta">{{ n.lengthMm | number:'1.0-0' }}mm</span> }
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

          @if (!selectedNodeId()) {
            <p class="select-hint"><mat-icon>touch_app</mat-icon>Select an item in the tree to highlight it in 3D.</p>
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
    .spacer { flex: 1; }
    .tree-search { display: flex; align-items: center; gap: 5px; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 5px 9px; }
    .tree-search mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); }
    .tree-search input { border: none; outline: none; background: transparent; font-size: 13px; color: var(--clay-text); font-family: inherit; width: 200px; }
    .tree-search .clear { background: none; border: none; color: var(--clay-text-muted); cursor: pointer; font-size: 15px; font-weight: 700; padding: 0 2px; }
    .search-info { margin: 0 0 10px; font-size: 12px; color: var(--clay-text-muted); }
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
  treeQuery = '';
  selectedGuid = signal<string | null>(null);
  selectedNodeId = signal<string | null>(null);
  highlightGuids = signal<string[]>([]);
  isolate = signal(false);

  private pendingFocus: string | null = null;
  private focusApplied = false;

  constructor() {
    // Apply a ?focus=<nodeId> deep-link once nodes load.
    effect(() => {
      const nodes = this.store.nodes();
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

  /** Search: flat match over mark / name / profile (used instead of the tree when a query is set). */
  matches(n: AssemblyNode): boolean {
    const term = this.treeQuery.trim().toLowerCase();
    if (!term) return true;
    return `${n.mark ?? ''} ${n.name ?? ''} ${n.profile ?? ''}`.toLowerCase().includes(term);
  }
  matchCount(): number { return this.store.nodes().filter((n) => this.matches(n)).length; }

  /** IFC files often leave spatial levels unnamed ("Undefined") — fall back to the IFC class. */
  displayName(n: AssemblyNode): string {
    const name = (n.name ?? '').trim();
    if (name && name.toLowerCase() !== 'undefined') return name;
    const byClass: Record<string, string> = {
      IfcProject: 'Project', IfcSite: 'Site', IfcBuilding: 'Building',
      IfcBuildingStorey: 'Level', IfcSpace: 'Space', IfcElementAssembly: 'Assembly',
    };
    if (n.ifcClass && byClass[n.ifcClass]) return byClass[n.ifcClass];
    return n.mark || `Unnamed ${n.nodeType}`;
  }

  onNodeClick(n: AssemblyNode): void { this.select(n); }
  private select(n: AssemblyNode): void {
    this.selectedGuid.set(n.ifcGuid);
    this.selectedNodeId.set(n.id);
    this.highlightGuids.set(this.descendantGuids(n));
    this.isolate.set(false);
  }
  onMeshClicked(name: string): void {
    this.selectedGuid.set(name);
    this.highlightGuids.set([name]);
    const node = this.store.nodes().find((n) => n.ifcGuid === name);
    if (node) {
      this.selectedNodeId.set(node.id);
      let p = node.parentId; const byId = this.byId();
      while (p) { this.collapsed.delete(p); p = byId.get(p)?.parentId ?? null; }
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

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length ? input.files[0] : null;
    if (file) this.store.importIfc(file);
    input.value = '';
  }

  typeIcon(t: NodeType): string { return { group: 'folder', assembly: 'widgets', subassembly: 'account_tree', part: 'square_foot' }[t] ?? 'circle'; }
}
