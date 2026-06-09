import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HttpEventType } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ThreeViewerComponent } from '../shared/components/three-viewer/three-viewer.component';
import { environment } from '../../environments/environment';
import { ProjectsService, Project, AssemblyNode, NodeType, NodeProductionStatus } from '../core/services/projects.service';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatProgressSpinnerModule, ThreeViewerComponent],
  template: `
    <div class="page">
      <a class="back" routerLink="/projects"><mat-icon>arrow_back</mat-icon>&nbsp;Projects</a>

      @if (loading) {
        <div class="center"><mat-spinner diameter="36"></mat-spinner></div>
      } @else if (project) {
        <div class="head">
          <div>
            <h1>{{ project.name }}</h1>
            <p class="sub">
              @if (project.projectNumber) { <span>Job {{ project.projectNumber }}</span> }
              @if (project.clientName) { <span> · {{ project.clientName }}</span> }
              <span> · <span class="chip st-{{ project.status }}">{{ project.status }}</span></span>
            </p>
          </div>
          <div class="actions">
            <input #fileInput type="file" hidden accept=".ifc" (change)="onFile($event)">
            <button mat-stroked-button color="primary" (click)="fileInput.click()" [disabled]="importing">
              <mat-icon>upload_file</mat-icon>&nbsp;Import IFC
            </button>
          </div>
        </div>

        @if (importing) {
          <mat-progress-bar [mode]="uploadProgress < 100 ? 'determinate' : 'indeterminate'" [value]="uploadProgress"></mat-progress-bar>
          <p class="hint">{{ uploadProgress < 100 ? 'Uploading ' + uploadProgress + '%' : 'Extracting assembly structure…' }}</p>
        }
        @if (error) { <p class="err">{{ error }}</p> }

        <div class="summary">
          <span class="scard"><strong>{{ nodes.length }}</strong> nodes</span>
          @for (c of typeCounts(); track c.key) {
            <span class="scard"><strong>{{ c.value }}</strong> {{ c.key }}</span>
          }
          @if (totalWeight() > 0) { <span class="scard"><strong>{{ totalWeight() | number:'1.0-0' }}</strong> kg</span> }
        </div>

        @if (nodes.length === 0) {
          <div class="empty">
            <mat-icon>account_tree</mat-icon>
            <p>No assemblies yet. Import an IFC file to build this project's tree.</p>
          </div>
        } @else {
          <div class="wobar">
            @if (processes.length) {
              <select class="proc" (change)="selectedProcessId = $any($event.target).value">
                <option value="">Route through process…</option>
                @for (p of processes; track p.id) { <option [value]="p.id">{{ p.name }}</option> }
              </select>
              <button mat-flat-button color="primary" [disabled]="generating || !selectedProcessId" (click)="generate()">
                {{ generating ? 'Generating…' : 'Generate work orders' }}
              </button>
            }
            <button mat-stroked-button [disabled]="recomputing" (click)="recompute()">
              <mat-icon>sync</mat-icon>&nbsp;{{ recomputing ? 'Refreshing…' : 'Refresh status' }}
            </button>
            @if (genMsg) { <span class="genmsg">{{ genMsg }}</span> }
          </div>
          <div class="layout">
            <div class="tree">
              @for (n of nodes; track n.id) {
                @if (visible(n)) {
                  <div class="node" [class.sel]="selectedGuid === n.ifcGuid" [style.padding-left.px]="8 + n.depth * 18" (click)="onNodeClick(n)">
                    @if (hasChildren(n)) {
                      <button class="caret" (click)="toggle(n); $event.stopPropagation()">
                        <mat-icon>{{ collapsed.has(n.id) ? 'chevron_right' : 'expand_more' }}</mat-icon>
                      </button>
                    } @else { <span class="caret-spacer"></span> }
                    <mat-icon class="ntype t-{{ n.nodeType }}">{{ typeIcon(n.nodeType) }}</mat-icon>
                    <span class="nname">{{ n.name }}</span>
                    @if (n.mark) { <span class="mark">{{ n.mark }}</span> }
                    @if (n.quantity > 1) { <span class="qty">×{{ n.quantity }}</span> }
                    @if (n.profile) { <span class="meta">{{ n.profile }}</span> }
                    @if (n.materialGrade) { <span class="meta grade">{{ n.materialGrade }}</span> }
                    @if (n.lengthMm) { <span class="meta">{{ n.lengthMm | number:'1.0-0' }}mm</span> }
                    <span class="spacer"></span>
                    @if (n.nodeType !== 'group') {
                      <span class="status ps-{{ n.productionStatus }}">{{ statusLabel(n.productionStatus) }}</span>
                      @if (n.percentComplete > 0) { <span class="pct">{{ n.percentComplete }}%</span> }
                    }
                  </div>
                }
              }
            </div>
            <div class="viewer-pane">
              @if (modelUrl) {
                <app-three-viewer [modelUrl]="modelUrl" [highlightNames]="highlightGuids" (meshClicked)="onMeshClicked($event)"></app-three-viewer>
                <p class="vhint">Click a part in the tree to highlight it in 3D — or click it in the model to find it in the tree.</p>
              } @else {
                <div class="noviewer">
                  <mat-icon>view_in_ar</mat-icon>
                  <p>3D model not available yet. Re-import a smaller IFC, or generate the model via the conversion pipeline.</p>
                </div>
              }
            </div>
          </div>
        }
      } @else {
        <div class="empty"><p>Project not found.</p></div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px; max-width: 1280px; margin: 0 auto; }
    .back { display: inline-flex; align-items: center; color: #6b7280; text-decoration: none; font-size: .9rem; margin-bottom: 12px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    h1 { margin: 0; font-size: 1.5rem; }
    .sub { margin: 4px 0 0; color: #6b7280; font-size: .9rem; }
    .chip { padding: 1px 8px; border-radius: 999px; font-size: .76rem; font-weight: 600; text-transform: capitalize; }
    .st-planning { background: #eef2ff; color: #4338ca; } .st-active { background: #ecfdf5; color: #047857; }
    .st-on_hold { background: #fef3c7; color: #b45309; } .st-completed { background: #e0f2fe; color: #0369a1; } .st-archived { background: #f3f4f6; color: #6b7280; }
    .center, .empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 56px 0; color: #6b7280; }
    .empty mat-icon { font-size: 44px; height: 44px; width: 44px; opacity: .5; }
    .hint { color: #6b7280; font-size: .85rem; } .err { color: #b91c1c; font-size: .85rem; }
    .summary { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
    .scard { background: var(--mat-sys-surface, #fff); border: 1px solid rgba(0,0,0,.08); border-radius: 10px; padding: 8px 14px; font-size: .85rem; color: #6b7280; }
    .scard strong { color: #111827; font-size: 1rem; margin-right: 4px; }
.wobar { display: flex; align-items: center; gap: 10px; margin: 4px 0 14px; flex-wrap: wrap; }
    .wobar .proc { padding: 7px 10px; border: 1px solid rgba(0,0,0,.15); border-radius: 8px; background: var(--mat-sys-surface, #fff); font-size: .9rem; }
    .wobar .genmsg { color: #047857; font-size: .82rem; }
    .layout { display: flex; gap: 16px; align-items: flex-start; }
    .tree { flex: 1; min-width: 0; background: var(--mat-sys-surface, #fff); border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); overflow: hidden; }
    .viewer-pane { width: 460px; flex-shrink: 0; position: sticky; top: 16px; }
    .viewer-pane app-three-viewer { display: block; height: 460px; }
    .vhint { color: #6b7280; font-size: .78rem; margin: 8px 2px; }
    .noviewer { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 16px; color: #9ca3af; background: var(--mat-sys-surface, #fff); border-radius: 12px; text-align: center; }
    .node { display: flex; align-items: center; gap: 8px; padding: 6px 14px 6px 8px; border-bottom: 1px solid rgba(0,0,0,.05); font-size: .9rem; cursor: pointer; }
    .node:hover { background: rgba(0,0,0,.025); }
    .node.sel { background: rgba(37,99,235,.10); }
    .caret { background: none; border: none; cursor: pointer; padding: 0; display: flex; color: #6b7280; }
    .caret mat-icon { font-size: 20px; height: 20px; width: 20px; }
    .caret-spacer { width: 20px; display: inline-block; }
    .ntype { font-size: 18px; height: 18px; width: 18px; }
    .t-group { color: #9ca3af; } .t-assembly { color: #2563eb; } .t-subassembly { color: #7c3aed; } .t-part { color: #64748b; }
    .nname { font-weight: 500; }
    .mark { background: #1118270d; border: 1px solid rgba(0,0,0,.1); border-radius: 6px; padding: 0 6px; font-size: .78rem; font-weight: 600; }
    .qty { color: #6b7280; font-size: .8rem; }
    .meta { color: #6b7280; font-size: .8rem; } .meta.grade { color: #047857; }
    .spacer { flex: 1; }
    .status { padding: 1px 8px; border-radius: 999px; font-size: .74rem; font-weight: 600; }
    .ps-not_started { background: #f3f4f6; color: #6b7280; } .ps-in_progress { background: #fef3c7; color: #b45309; }
    .ps-ready_to_ship { background: #ecfdf5; color: #047857; } .ps-shipped { background: #e0f2fe; color: #0369a1; } .ps-on_hold { background: #fee2e2; color: #b91c1c; }
    .pct { color: #6b7280; font-size: .78rem; min-width: 34px; text-align: right; }
    @media (max-width: 900px) { .layout { flex-direction: column; } .viewer-pane { width: 100%; position: static; } }
  `],
})
export class ProjectDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private svc = inject(ProjectsService);

  id = '';
  project: Project | null = null;
  nodes: AssemblyNode[] = [];
  loading = true;
  collapsed = new Set<string>();
  private byId = new Map<string, AssemblyNode>();
  private childCount = new Map<string, number>();
  private childrenByParent = new Map<string, AssemblyNode[]>();

  selectedGuid: string | null = null;
  highlightGuids: string[] = [];

  importing = false;
  uploadProgress = 0;
  error: string | null = null;

  processes: { id: string; name: string }[] = [];
  selectedProcessId = '';
  generating = false;
  recomputing = false;
  genMsg: string | null = null;

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
    this.svc.listProcesses().subscribe({ next: (p) => (this.processes = p), error: () => {} });
  }

  load(): void {
    this.loading = true;
    this.svc.get(this.id).subscribe({
      next: (p) => { this.project = p; },
      error: () => { this.project = null; this.loading = false; },
    });
    this.svc.nodes(this.id).subscribe({
      next: (n) => { this.setNodes(n); this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  private setNodes(nodes: AssemblyNode[]): void {
    this.nodes = nodes;
    this.byId = new Map(nodes.map((n) => [n.id, n]));
    this.childCount = new Map();
    this.childrenByParent = new Map();
    for (const n of nodes) {
      if (n.parentId) {
        this.childCount.set(n.parentId, (this.childCount.get(n.parentId) ?? 0) + 1);
        const arr = this.childrenByParent.get(n.parentId) ?? [];
        arr.push(n);
        this.childrenByParent.set(n.parentId, arr);
      }
    }
  }

  get modelUrl(): string | null {
    const withModel = this.nodes.find((n) => n.modelId);
    return withModel?.modelId ? `${environment.apiUrl}/models/${withModel.modelId}/file` : null;
  }

  hasChildren(n: AssemblyNode): boolean {
    return (this.childCount.get(n.id) ?? 0) > 0;
  }

  /** A node is hidden if any ancestor is collapsed. */
  visible(n: AssemblyNode): boolean {
    let p = n.parentId;
    while (p) {
      if (this.collapsed.has(p)) return false;
      p = this.byId.get(p)?.parentId ?? null;
    }
    return true;
  }

  toggle(n: AssemblyNode): void {
    if (this.collapsed.has(n.id)) this.collapsed.delete(n.id);
    else this.collapsed.add(n.id);
  }

  onNodeClick(n: AssemblyNode): void {
    this.selectedGuid = n.ifcGuid;
    this.highlightGuids = this.descendantGuids(n);
  }

  onMeshClicked(name: string): void {
    this.selectedGuid = name;
    this.highlightGuids = [name];
    const node = this.nodes.find((n) => n.ifcGuid === name);
    if (node) {
      let p = node.parentId;
      while (p) { this.collapsed.delete(p); p = this.byId.get(p)?.parentId ?? null; }
    }
  }

  private descendantGuids(n: AssemblyNode): string[] {
    const out: string[] = [];
    const stack: AssemblyNode[] = [n];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur.ifcGuid) out.push(cur.ifcGuid);
      for (const c of (this.childrenByParent.get(cur.id) ?? [])) stack.push(c);
    }
    return out;
  }

  typeCounts(): { key: string; value: number }[] {
    const c: Record<string, number> = {};
    for (const n of this.nodes) c[n.nodeType] = (c[n.nodeType] ?? 0) + 1;
    return Object.entries(c).map(([key, value]) => ({ key, value }));
  }

  totalWeight(): number {
    return this.nodes.reduce((s, n) => s + (n.nodeType === 'part' ? (n.weightKg ?? 0) * (n.quantity ?? 1) : 0), 0);
  }

  typeIcon(t: NodeType): string {
    return { group: 'folder', assembly: 'widgets', subassembly: 'account_tree', part: 'square_foot' }[t] ?? 'circle';
  }

  statusLabel(s: NodeProductionStatus): string {
    return {
      not_started: 'Not started', in_progress: 'In progress',
      ready_to_ship: 'Ready to ship', shipped: 'Shipped', on_hold: 'On hold',
    }[s] ?? s;
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length ? input.files[0] : null;
    if (file) this.importIfc(file);
    input.value = '';
  }

  generate(): void {
    if (!this.selectedProcessId) return;
    this.generating = true;
    this.genMsg = null;
    this.svc.generateWorkOrders(this.id, this.selectedProcessId).subscribe({
      next: (r) => { this.generating = false; this.genMsg = `Created ${r.created} work orders (${r.skipped} already existed).`; this.recompute(); },
      error: (e) => { this.generating = false; this.genMsg = e?.error?.message || 'Generation failed'; },
    });
  }

  recompute(): void {
    this.recomputing = true;
    this.svc.recomputeStatus(this.id).subscribe({
      next: () => { this.recomputing = false; this.load(); },
      error: () => { this.recomputing = false; },
    });
  }

  private importIfc(file: File): void {
    this.error = null;
    this.importing = true;
    this.uploadProgress = 0;
    this.svc.importIfc(this.id, file).subscribe({
      next: (ev) => {
        if (ev.type === HttpEventType.UploadProgress && ev.total) {
          this.uploadProgress = Math.round((100 * ev.loaded) / ev.total);
        } else if (ev.type === HttpEventType.Response) {
          this.importing = false;
          this.load();
        }
      },
      error: (e) => {
        this.importing = false;
        this.error = e?.error?.message || 'Import failed — the file may not be a valid IFC.';
      },
    });
  }
}
