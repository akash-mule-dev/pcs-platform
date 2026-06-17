import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ThreeViewerComponent, ViewerReferenceLength } from '../shared/components/three-viewer/three-viewer.component';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { ProjectsService, AssemblyNode, NodeType, NodeDocument, NodeLotRow, LotOption } from '../core/services/projects.service';

/** Dimension-like IFC property keys surfaced in the detail panel. */
const DIM_KEYS = ['width', 'height', 'depth', 'thickness', 'diameter', 'radius', 'length', 'weight', 'area', 'volume', 'perimeter', 'elevation'];

/** Assemblies & 3D tab: the assembly tree (left, internally scrolled so the
 *  search bar never leaves the screen) with a synced 3D viewer + selected-part
 *  detail panel (right). Pure design view — production tracking and quality
 *  live inside each work order. */
@Component({
  selector: 'app-project-assemblies',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, ThreeViewerComponent],
  template: `
    @if (store.loading() && !store.hasNodes()) {
      <div class="center"><mat-spinner diameter="36"></mat-spinner></div>
    } @else if (!store.hasNodes()) {
      <div class="empty-state">
        @if (store.pipelineActive()) {
          <mat-spinner diameter="34"></mat-spinner>
          <h3>Import in progress</h3>
          <p>
            @if (store.importing()) { Uploading… {{ store.uploadProgress() }}% }
            @else {
              @if (store.currentImport(); as imp) { {{ imp.originalName }} — {{ imp.progress }}% · {{ store.pipelineMessage() || 'processing' }} }
            }
            <br>The assembly tree will appear here as soon as the structure is extracted.
          </p>
        } @else {
          <mat-icon>account_tree</mat-icon>
          <h3>No assemblies yet</h3>
          <p>Upload an IFC / STEP model or a ZIP package (Tekla, SDS2, Advance Steel exports: model + PDF drawings). Structure, 3D and drawings are extracted automatically.</p>
          <input #fileInput type="file" hidden accept=".ifc,.zip,.step,.stp,.iges,.igs,.glb,.gltf,.obj,.stl,.dae,.fbx,.3ds,.ply" (change)="onFile($event)">
          <button class="cta" (click)="fileInput.click()" [disabled]="store.importing()"><mat-icon>upload_file</mat-icon>Import package / model</button>
        }
      </div>
    } @else {
      <div class="layout">
        <!-- Tree card: fixed header (search + tools), internally scrolling list -->
        <section class="tree-pane">
          <div class="tree-head">
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
          <div class="tree-scroll">
            @for (n of store.nodes(); track n.id) {
              @if (treeQuery ? matches(n) : visible(n)) {
                <div class="node" [class.sel]="selectedNodeId() === n.id" [style.padding-left.px]="treeQuery ? 10 : 10 + n.depth * 18" (click)="onNodeClick(n)">
                  @if (!treeQuery && hasChildren(n)) {
                    <button class="caret" (click)="toggle(n); $event.stopPropagation()"><mat-icon>{{ collapsed.has(n.id) ? 'chevron_right' : 'expand_more' }}</mat-icon></button>
                  } @else { <span class="caret-spacer"></span> }
                  <mat-icon class="ntype t-{{ n.nodeType }}">{{ typeIcon(n.nodeType) }}</mat-icon>
                  <span class="nname">{{ displayName(n) }}</span>
                  @if (n.mark) { <span class="mark">{{ n.mark }}</span> }
                  @if (n.quantity > 1) { <span class="qty">×{{ n.quantity }}</span> }
                  @if (defined(n.profile); as p) { <span class="meta">{{ p }}</span> }
                  @if (defined(n.materialGrade); as g) { <span class="meta grade">{{ g }}</span> }
                  @if (n.lengthMm) { <span class="meta">{{ n.lengthMm | number:'1.0-0' }}mm</span> }
                </div>
              }
            }
          </div>
        </section>

        <!-- Viewer + selected-part details -->
        <aside class="viewer-pane">
          @if (modelUrl(); as url) {
            <div class="viewer-tools">
              <span class="vt-hint">{{ isolate() ? 'Isolated view' : 'Click a part to highlight' }}</span>
              <button type="button" class="iso-btn" [class.on]="isolate()" [disabled]="!isolate() && !canIsolate()" (click)="toggleIsolate()">
                <mat-icon>{{ isolate() ? 'fullscreen' : 'filter_center_focus' }}</mat-icon>{{ isolate() ? 'Show full model' : 'Isolate selected' }}
              </button>
            </div>
            <div class="viewer-box"><app-three-viewer [modelUrl]="url" [highlightNames]="isolate() ? [] : highlightGuids()" [autoFocus]="true" [showTools]="true" [referenceLengths]="referenceLengths()" (meshClicked)="onMeshClicked($event)"></app-three-viewer></div>
          } @else {
            <div class="noviewer">
              <mat-icon>view_in_ar</mat-icon>
              @if (store.modelPending()) { <p>3D model is converting in the background. It'll appear here shortly.</p> }
              @else { <p>No 3D model for this project yet.</p> }
            </div>
          }

          @if (selectedNode(); as n) {
            <div class="detail-card">
              <div class="d-head">
                <mat-icon class="ntype t-{{ n.nodeType }}">{{ typeIcon(n.nodeType) }}</mat-icon>
                <span class="d-name" [title]="displayName(n)">{{ displayName(n) }}</span>
                @if (n.mark) { <span class="mark">{{ n.mark }}</span> }
                <span class="d-type">{{ n.nodeType }}</span>
              </div>
              @if (selectedFacts().length) {
                <div class="d-grid">
                  @for (f of selectedFacts(); track f.label) {
                    <div class="d-fact"><span class="d-lbl">{{ f.label }}</span><span class="d-val">{{ f.value }}</span></div>
                  }
                </div>
              } @else {
                <p class="d-empty">No dimension data was found for this item in the IFC file.</p>
              }

              <!-- Shop drawings / documents on this piece -->
              <div class="ext-sec">
                <div class="ext-head">
                  <mat-icon>picture_as_pdf</mat-icon><strong>Drawings &amp; documents</strong>
                  <span class="ext-spacer"></span>
                  <input #docInput type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp" (change)="onDocFile($event)">
                  <button class="mini-btn" (click)="docInput.click()" [disabled]="docBusy()">
                    <mat-icon>upload_file</mat-icon>{{ docBusy() ? 'Uploading…' : 'Attach' }}
                  </button>
                </div>
                @for (d of docs(); track d.id) {
                  <div class="ext-row">
                    <mat-icon class="ext-ic">{{ d.contentType === 'application/pdf' ? 'picture_as_pdf' : 'image' }}</mat-icon>
                    <button class="ext-link" (click)="openDoc(d)" [title]="d.originalName">{{ d.label || d.originalName }}</button>
                    <span class="ext-meta">{{ fmtBytes(d.size) }}</span>
                    <button class="ext-x" (click)="deleteDoc(d)" title="Remove"><mat-icon>close</mat-icon></button>
                  </div>
                } @empty {
                  <p class="ext-empty">No documents yet — attach the shop drawing so the floor sees it with the piece.</p>
                }
              </div>

              <!-- Heat-number traceability -->
              <div class="ext-sec">
                <div class="ext-head"><mat-icon>tag</mat-icon><strong>Heat numbers</strong></div>
                @for (l of lots(); track l.id) {
                  <div class="ext-row">
                    <span class="heat">{{ l.heat_number || l.lot_number }}</span>
                    <span class="ext-meta trunc">{{ l.material_code || l.material_name || '' }}{{ l.supplier ? ' · ' + l.supplier : '' }}{{ l.cert_reference ? ' · cert ' + l.cert_reference : '' }}</span>
                    <span class="ext-spacer"></span>
                    <button class="ext-x" (click)="removeLot(l)" title="Unassign"><mat-icon>close</mat-icon></button>
                  </div>
                } @empty {
                  <p class="ext-empty">No heat number assigned to this piece.</p>
                }
                <div class="lot-add">
                  <select class="lot-sel" [(ngModel)]="lotPick">
                    <option value="">Assign a lot / heat #…</option>
                    @for (o of lotOptions(); track o.id) {
                      <option [value]="o.id">{{ o.heat_number || o.lot_number }}{{ o.material_code ? ' · ' + o.material_code : '' }}{{ o.supplier ? ' · ' + o.supplier : '' }}</option>
                    }
                  </select>
                  <button class="mini-btn" (click)="assignLot()" [disabled]="!lotPick || lotBusy()">Assign</button>
                </div>
              </div>
            </div>
          } @else {
            <div class="detail-card hint">
              <mat-icon>touch_app</mat-icon>
              <p>Select an item in the tree — or click a part in the 3D view — to see its measurements here.</p>
            </div>
          }
        </aside>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .center { display: flex; justify-content: center; padding: 56px 0; }
    .cta { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; background: var(--clay-primary); color: #fff; padding: 10px 18px; border-radius: var(--clay-radius-sm); font-size: 13px; font-weight: 600; border: none; cursor: pointer; }
    .cta mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .cta:disabled { opacity: .6; cursor: default; }

    /* Two-pane layout sized to the viewport so the tree scrolls internally
       (search bar + viewer always stay on screen). */
    .layout { display: flex; gap: 16px; align-items: stretch; height: calc(100vh - 332px); min-height: 480px; }

    /* ── Tree card (fixed width — the 3D viewer gets the remaining space) ── */
    .tree-pane {
      flex: 0 1 440px; min-width: 340px; display: flex; flex-direction: column;
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius); box-shadow: var(--clay-shadow-soft); overflow: hidden;
    }
    .tree-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border-bottom: 1px solid var(--clay-border); flex-shrink: 0; }
    .spacer { flex: 1; }
    .tree-search { display: flex; align-items: center; gap: 5px; background: var(--clay-bg); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm); padding: 5px 9px; flex: 1 1 140px; min-width: 120px; }
    .tree-search mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--clay-text-muted); }
    .tree-search input { border: none; outline: none; background: transparent; font-size: 13px; color: var(--clay-text); font-family: inherit; width: 100%; min-width: 0; }
    .tree-search .clear { background: none; border: none; color: var(--clay-text-muted); cursor: pointer; font-size: 15px; font-weight: 700; padding: 0 2px; }
    .search-info { margin: 0; padding: 7px 14px; font-size: 12px; color: var(--clay-text-muted); border-bottom: 1px solid var(--clay-border); flex-shrink: 0; }
    .tree-tools { font-size: 12px; color: var(--clay-text-muted); white-space: nowrap; }
    .link-btn { background: none; border: none; color: var(--clay-primary); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; padding: 0; }
    .tree-tools .sep { margin: 0 4px; }

    .tree-scroll { flex: 1; min-height: 0; overflow-y: auto; }
    .node { display: flex; align-items: center; gap: 8px; padding: 7px 14px 7px 10px; border-bottom: 1px solid var(--clay-border); font-size: 13px; cursor: pointer; transition: background .12s; min-width: 0; }
    .node:last-child { border-bottom: none; }
    .node:hover { background: var(--clay-surface-hover); }
    .node.sel { background: var(--info-bg); box-shadow: inset 3px 0 0 var(--clay-primary); }
    .caret { background: none; border: none; cursor: pointer; padding: 0; display: flex; color: var(--clay-text-muted); flex-shrink: 0; }
    .caret mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .caret-spacer { width: 20px; display: inline-block; flex-shrink: 0; }
    .ntype { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .t-group { color: var(--clay-text-muted); } .t-assembly { color: var(--clay-primary); }
    .t-subassembly { color: var(--kpi-purple-fg); } .t-part { color: var(--clay-text-secondary); }
    .nname { font-weight: 500; color: var(--clay-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 48px; flex: 0 1 auto; }
    .mark { background: var(--clay-bg-warm); border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); padding: 0 6px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); font-family: 'Space Grotesk', monospace; flex-shrink: 0; }
    .qty { color: var(--clay-text-muted); font-size: 12px; flex-shrink: 0; }
    .meta { color: var(--clay-text-muted); font-size: 12px; white-space: nowrap; flex-shrink: 0; } .meta.grade { color: var(--success-text); }

    /* ── Viewer + details column ── */
    .viewer-pane { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
    .viewer-tools { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .vt-hint { font-size: 12px; color: var(--clay-text-muted); }
    .viewer-box { flex: 1 1 auto; min-height: 240px; }
    .viewer-box app-three-viewer { display: block; height: 100%; }
    .iso-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--clay-primary); background: var(--clay-surface); color: var(--clay-primary); border-radius: var(--clay-radius-sm); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .iso-btn:hover:not(:disabled) { background: var(--info-bg); }
    .iso-btn.on { background: var(--clay-primary); color: #fff; }
    .iso-btn:disabled { opacity: .5; cursor: default; border-color: var(--clay-border); color: var(--clay-text-muted); }
    .iso-btn mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .noviewer { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px 16px; color: var(--clay-text-muted); background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); text-align: center; flex: 1; justify-content: center; min-height: 240px; }
    .noviewer mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }

    /* Selected-part detail panel */
    .detail-card {
      flex-shrink: 0; max-height: 42%; overflow-y: auto;
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius); box-shadow: var(--clay-shadow-soft); padding: 12px 14px;
    }
    .detail-card.hint { display: flex; align-items: center; gap: 10px; color: var(--clay-text-muted); }
    .detail-card.hint mat-icon { font-size: 22px; width: 22px; height: 22px; flex-shrink: 0; }
    .detail-card.hint p { margin: 0; font-size: 13px; }
    .d-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .d-name { font-size: 14px; font-weight: 600; color: var(--clay-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .d-type { margin-left: auto; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); background: var(--clay-bg-warm); border-radius: 999px; padding: 2px 8px; flex-shrink: 0; }
    .d-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin-top: 12px; }
    .d-fact { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .d-lbl { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); }
    .d-val { font-size: 13px; font-weight: 600; color: var(--clay-text); font-family: 'Space Grotesk', 'Inter', sans-serif; overflow-wrap: anywhere; }
    .d-empty { margin: 10px 0 0; font-size: 12px; color: var(--clay-text-muted); }

    /* ── Per-piece extras: drawings + heat numbers ── */
    .ext-sec { margin-top: 12px; border-top: 1px dashed var(--clay-border); padding-top: 10px; }
    .ext-head { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
    .ext-head mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--clay-primary); }
    .ext-head strong { font-size: 12.5px; color: var(--clay-text); }
    .ext-spacer { flex: 1; }
    .mini-btn { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); border-radius: var(--clay-radius-xs); padding: 4px 9px; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .mini-btn mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .mini-btn:hover:not(:disabled) { border-color: var(--clay-primary); color: var(--clay-primary); }
    .mini-btn:disabled { opacity: .55; cursor: default; }
    .ext-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12.5px; min-width: 0; }
    .ext-ic { font-size: 16px; width: 16px; height: 16px; color: var(--clay-text-muted); flex-shrink: 0; }
    .ext-link { background: none; border: none; color: var(--clay-primary); font-weight: 600; font-size: 12.5px; cursor: pointer; font-family: inherit; padding: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
    .ext-link:hover { text-decoration: underline; }
    .ext-meta { color: var(--clay-text-muted); font-size: 11.5px; flex-shrink: 1; }
    .ext-meta.trunc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ext-x { background: none; border: none; color: var(--clay-text-muted); cursor: pointer; display: flex; padding: 2px; flex-shrink: 0; }
    .ext-x mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .ext-x:hover { color: var(--danger-text); }
    .ext-empty { margin: 2px 0 4px; font-size: 11.5px; color: var(--clay-text-muted); font-style: italic; }
    .heat { background: var(--info-bg); color: var(--clay-primary); border-radius: var(--clay-radius-xs); padding: 1px 8px; font-size: 11.5px; font-weight: 700; font-family: 'Space Grotesk', monospace; flex-shrink: 0; }
    .lot-add { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
    .lot-sel { flex: 1; min-width: 0; border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs); background: var(--clay-surface); color: var(--clay-text); padding: 5px 8px; font-size: 12px; font-family: inherit; }

    @media (max-width: 960px) {
      .layout { flex-direction: column; height: auto; }
      .tree-pane { height: 440px; flex: none; min-width: 0; }
      .viewer-pane { width: 100%; flex: none; }
      .viewer-box { flex: none; height: 320px; }
      .detail-card { max-height: none; }
    }
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

  selectedNode = computed(() => {
    const id = this.selectedNodeId();
    return id ? this.byId().get(id) ?? null : null;
  });

  /** Feed the 3D viewer known true lengths so it can self-calibrate the model's
   *  unit scale (the GLB carries the IFC's native units) and report real mm. */
  referenceLengths = computed<ViewerReferenceLength[]>(() =>
    this.store.nodes()
      .filter((n) => n.ifcGuid && n.lengthMm != null && n.lengthMm > 0)
      .map((n) => ({ meshName: n.ifcGuid as string, lengthMm: n.lengthMm as number })),
  );

  /** Measurements & identity facts for the detail panel: promoted fab columns
   *  first, then dimension-like entries from the raw IFC property bag. */
  selectedFacts = computed<{ label: string; value: string }[]>(() => {
    const n = this.selectedNode();
    if (!n) return [];
    const facts: { label: string; value: string }[] = [];
    const profile = this.defined(n.profile);
    const grade = this.defined(n.materialGrade);
    if (profile) facts.push({ label: 'Profile', value: profile });
    if (grade) facts.push({ label: 'Material grade', value: grade });
    if (n.lengthMm != null) facts.push({ label: 'Length', value: `${this.fmtNum(n.lengthMm)} mm` });
    if (n.weightKg != null) facts.push({ label: 'Weight', value: `${this.fmtNum(n.weightKg)} kg` });
    if (n.quantity > 1) facts.push({ label: 'Quantity', value: `${n.quantity}` });
    if (n.ifcClass) facts.push({ label: 'IFC class', value: n.ifcClass });

    const seen = new Set(facts.map((f) => f.label.toLowerCase()));
    for (const [key, raw] of Object.entries(n.properties ?? {})) {
      if (key.includes('.')) continue; // namespaced duplicate of a plain key
      const norm = key.replace(/[^a-z]/gi, '').toLowerCase();
      if (!DIM_KEYS.some((k) => norm.includes(k))) continue;
      if (n.lengthMm != null && norm === 'length') continue;
      if (n.weightKg != null && norm.includes('weight')) continue;
      const num = typeof raw === 'number' ? raw
        : typeof raw === 'string' && raw.trim() !== '' && !isNaN(+raw) ? +raw : null;
      if (num == null) continue;
      const label = this.prettyKey(key);
      if (seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      facts.push({ label, value: this.fmtNum(num) });
      if (facts.length >= 18) break;
    }
    return facts;
  });

  private pendingFocus: string | null = null;
  private focusApplied = false;

  // ── Per-piece extras: shop drawings + heat numbers ──
  readonly docs = signal<NodeDocument[]>([]);
  readonly lots = signal<NodeLotRow[]>([]);
  readonly lotOptions = signal<LotOption[]>([]);
  readonly docBusy = signal(false);
  readonly lotBusy = signal(false);
  lotPick = '';
  private lotOptionsLoaded = false;

  constructor() {
    // Apply a ?focus=<nodeId> deep-link once nodes load.
    effect(() => {
      const nodes = this.store.nodes();
      if (!this.focusApplied && this.pendingFocus && nodes.length) {
        const node = nodes.find((n) => n.id === this.pendingFocus);
        if (node) { this.select(node); this.focusApplied = true; this.scrollSelectedIntoView(); }
      }
    });
    // Load the selected piece's documents + heat numbers whenever selection changes.
    effect(() => {
      const id = this.selectedNodeId();
      this.docs.set([]);
      this.lots.set([]);
      this.lotPick = '';
      if (!id) return;
      this.svc.nodeDocuments(this.store.id(), id).subscribe({ next: (d) => { if (this.selectedNodeId() === id) this.docs.set(d); }, error: () => {} });
      this.svc.nodeLots(this.store.id(), id).subscribe({ next: (l) => { if (this.selectedNodeId() === id) this.lots.set(l); }, error: () => {} });
      if (!this.lotOptionsLoaded) {
        this.lotOptionsLoaded = true;
        this.svc.availableLots(this.store.id()).subscribe({ next: (o) => this.lotOptions.set(o), error: () => {} });
      }
    });
  }

  // ── Documents ──
  onDocFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const nodeId = this.selectedNodeId();
    input.value = '';
    if (!file || !nodeId) return;
    this.docBusy.set(true);
    this.svc.uploadNodeDocument(this.store.id(), nodeId, file).subscribe({
      next: (doc) => { this.docBusy.set(false); if (this.selectedNodeId() === nodeId) this.docs.set([doc, ...this.docs()]); },
      error: () => this.docBusy.set(false),
    });
  }
  openDoc(d: NodeDocument): void {
    this.svc.nodeDocumentBlob(this.store.id(), d.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: () => {},
    });
  }
  deleteDoc(d: NodeDocument): void {
    this.svc.deleteNodeDocument(this.store.id(), d.id).subscribe({
      next: () => this.docs.set(this.docs().filter((x) => x.id !== d.id)),
      error: () => {},
    });
  }

  // ── Heat numbers ──
  assignLot(): void {
    const nodeId = this.selectedNodeId();
    if (!nodeId || !this.lotPick) return;
    this.lotBusy.set(true);
    this.svc.assignLot(this.store.id(), nodeId, { materialLotId: this.lotPick }).subscribe({
      next: () => {
        this.lotBusy.set(false);
        this.lotPick = '';
        this.svc.nodeLots(this.store.id(), nodeId).subscribe({ next: (l) => { if (this.selectedNodeId() === nodeId) this.lots.set(l); }, error: () => {} });
      },
      error: () => this.lotBusy.set(false),
    });
  }
  removeLot(l: NodeLotRow): void {
    this.svc.unassignLot(this.store.id(), l.id).subscribe({
      next: () => this.lots.set(this.lots().filter((x) => x.id !== l.id)),
      error: () => {},
    });
  }

  fmtBytes(n: number | null): string {
    if (n == null) return '';
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
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
      this.scrollSelectedIntoView();
    }
  }
  private scrollSelectedIntoView(): void {
    setTimeout(() => document.querySelector('.tree-scroll .node.sel')?.scrollIntoView({ block: 'nearest' }));
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

  /** IFC exporters write the literal string "Undefined" for missing values — hide it. */
  defined(v: string | null): string | null {
    const t = (v ?? '').trim();
    return t && t.toLowerCase() !== 'undefined' ? t : null;
  }

  private fmtNum(v: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v);
  }
  /** "NetWeight" / "bottom_elevation" → "Net Weight" / "Bottom elevation". */
  private prettyKey(key: string): string {
    const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
}
