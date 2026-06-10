import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ThreeViewerComponent } from '../shared/components/three-viewer/three-viewer.component';
import { ProjectEditDialogComponent } from './project-edit-dialog.component';
import { environment } from '../../environments/environment';
import { ProjectsService, Project, AssemblyNode, NodeType, NodeProductionStatus, ProjectProgress, QualityEntry, RecordQuality, ProjectQualitySummary, QaStatus, QaSeverity } from '../core/services/projects.service';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatProgressSpinnerModule, MatDialogModule, ThreeViewerComponent],
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
            @if (processes.length) {
              <div class="procsel">
                <span class="pl">Process</span>
                <select [ngModel]="project.processId || ''" (ngModelChange)="updateProcess($event)" [ngModelOptions]="{ standalone: true }" [disabled]="savingProcess">
                  <option value="">— none —</option>
                  @for (p of processes; track p.id) { <option [value]="p.id">{{ p.name }}</option> }
                </select>
                @if (savingProcess) { <span class="psv">saving…</span> }
              </div>
            }
          </div>
          <div class="actions">
            <button mat-stroked-button (click)="editProject()">
              <mat-icon>edit</mat-icon>&nbsp;Edit
            </button>
            <input #fileInput type="file" hidden accept=".ifc" (change)="onFile($event)">
            <button mat-stroked-button color="primary" (click)="fileInput.click()" [disabled]="importing">
              <mat-icon>upload_file</mat-icon>&nbsp;Import IFC
            </button>
            <button mat-stroked-button [routerLink]="['/projects', id, 'progress']">
              <mat-icon>insights</mat-icon>&nbsp;Progress
            </button>
            <button mat-stroked-button [routerLink]="['/projects', id, 'shipping']">
              <mat-icon>local_shipping</mat-icon>&nbsp;Shipping
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

        @if (prog && nodes.length) {
          <div class="progstrip" [routerLink]="['/projects', id, 'progress']">
            <div class="ps-bar"><div class="ps-fill" [style.width.%]="prog.percentComplete"></div></div>
            <span class="ps-pct">{{ prog.percentComplete }}%</span>
            <span class="ps-meta">processed · {{ prog.status['ready_to_ship'] || 0 }} ready · {{ prog.status['shipped'] || 0 }} shipped</span>
            <span class="ps-link">View progress&nbsp;<mat-icon>chevron_right</mat-icon></span>
          </div>
        }

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
                      @if (qaDot(n); as qd) { <span class="qa-tdot qb-{{ qd }}" [attr.title]="'Quality: ' + qd"></span> }
                    }
                  </div>
                }
              }
            </div>
            <div class="viewer-pane">
              @if (modelUrl) {
                <div class="viewer-tools">
                  <button type="button" class="iso-btn" [class.on]="isolate" [disabled]="!isolate && !canIsolate()" (click)="toggleIsolate()">
                    <mat-icon>{{ isolate ? 'fullscreen' : 'filter_center_focus' }}</mat-icon>
                    {{ isolate ? 'Show full model' : 'Isolate selected' }}
                  </button>
                </div>
                <app-three-viewer [modelUrl]="modelUrl" [highlightNames]="isolate ? [] : highlightGuids" (meshClicked)="onMeshClicked($event)"></app-three-viewer>
                @if (isolate) {
                  <p class="vhint">Showing only the selected item. Pick another node in the tree to switch, or “Show full model”.</p>
                } @else {
                  <p class="vhint">Click a part in the tree to highlight it in 3D — or click it in the model to find it in the tree. Select one, then “Isolate selected” to view it alone.</p>
                }
              } @else {
                <div class="noviewer">
                  <mat-icon>view_in_ar</mat-icon>
                  @if (modelPending) {
                    <p>3D model is converting in the background (large file). Reload in a moment to view it.</p>
                  } @else {
                    <p>No 3D model yet for this project.</p>
                  }
                </div>
              }

              @if (selectedNodeId) {
                <div class="qa">
                  <div class="qa-head">
                    <mat-icon class="qa-ico">verified</mat-icon>
                    <span class="qa-title">Quality — {{ selectedNodeName() }}</span>
                    @if (qaNodeStatus(); as qs) { <span class="qa-badge qb-{{ qs }}">{{ qs }}</span> }
                    @if (qaNodeOpenNcr() > 0) { <span class="qa-badge qb-fail">{{ qaNodeOpenNcr() }} NCR</span> }
                  </div>

                  <div class="qa-actions">
                    <button class="qbtn pass" (click)="recordQuick('pass')" [disabled]="qaBusy">Pass</button>
                    <button class="qbtn warn" (click)="recordQuick('warning')" [disabled]="qaBusy">Warning</button>
                    <button class="qbtn fail" (click)="recordQuick('fail')" [disabled]="qaBusy">Fail</button>
                    <button class="qbtn" (click)="qaMeasureOpen = !qaMeasureOpen; qaNcrOpen = false">Measure…</button>
                    <button class="qbtn ncr" (click)="openNcr()">Raise NCR</button>
                  </div>

                  @if (qaMeasureOpen) {
                    <div class="qa-form">
                      <input type="number" placeholder="Value" [(ngModel)]="meas.value" />
                      <input type="text" placeholder="Unit" [(ngModel)]="meas.unit" />
                      <input type="number" placeholder="Tol min" [(ngModel)]="meas.min" />
                      <input type="number" placeholder="Tol max" [(ngModel)]="meas.max" />
                      <input class="grow" type="text" placeholder="Defect / notes" [(ngModel)]="meas.notes" />
                      <div class="qa-form-row">
                        <button class="qbtn measure" (click)="recordMeasure()" [disabled]="qaBusy || meas.value == null">Save measurement</button>
                        <span class="qa-hint">Out-of-tolerance auto-fails.</span>
                      </div>
                    </div>
                  }

                  @if (qaNcrOpen) {
                    <div class="qa-form">
                      <input class="grow" type="text" placeholder="Title" [(ngModel)]="ncr.title" />
                      <select [(ngModel)]="ncr.severity">
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                        <option value="critical">critical</option>
                      </select>
                      <textarea placeholder="Description (optional)" [(ngModel)]="ncr.description"></textarea>
                      <div class="qa-form-row">
                        <button class="qbtn ncr" (click)="submitNcr()" [disabled]="qaBusy">Raise NCR</button>
                        <button class="qbtn" (click)="qaNcrOpen = false">Cancel</button>
                      </div>
                    </div>
                  }

                  @if (qaMsg) { <p class="qa-msg">{{ qaMsg }}</p> }

                  @if (qaLoading) { <p class="qa-hint">Loading inspections…</p> }
                  @else if (qaList.length === 0) { <p class="qa-hint">No inspections yet for this item.</p> }
                  @else {
                    <div class="qa-list">
                      @for (q of qaList; track q.id) {
                        <div class="qa-item">
                          <span class="qa-dot qb-{{ q.status }}"></span>
                          <span class="qa-st">{{ q.status }}</span>
                          @if (q.measurementValue != null) { <span class="qa-meta">{{ q.measurementValue }}{{ q.measurementUnit }}</span> }
                          @if (q.defectType) { <span class="qa-meta">{{ q.defectType }}</span> }
                          @if (q.signoffStatus !== 'pending') { <span class="qa-meta">· {{ q.signoffStatus }}</span> }
                          <span class="qa-spacer"></span>
                          @if (q.status === 'fail') { <button class="qlink" (click)="openNcrFor(q)">NCR</button> }
                          <span class="qa-when">{{ q.createdAt | date:'MMM d' }}</span>
                        </div>
                      }
                    </div>
                  }
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
    .procsel { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .procsel .pl { font-size: .8rem; color: #6b7280; }
    .procsel select { padding: 6px 10px; border: 1px solid rgba(0,0,0,.15); border-radius: 8px; font-size: .85rem; background: var(--mat-sys-surface, #fff); }
    .procsel .psv { font-size: .78rem; color: #6b7280; }
    .chip { padding: 1px 8px; border-radius: 999px; font-size: .76rem; font-weight: 600; text-transform: capitalize; }
    .st-planning { background: #eef2ff; color: #4338ca; } .st-active { background: #ecfdf5; color: #047857; }
    .st-on_hold { background: #fef3c7; color: #b45309; } .st-completed { background: #e0f2fe; color: #0369a1; } .st-archived { background: #f3f4f6; color: #6b7280; }
    .center, .empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 56px 0; color: #6b7280; }
    .empty mat-icon { font-size: 44px; height: 44px; width: 44px; opacity: .5; }
    .hint { color: #6b7280; font-size: .85rem; } .err { color: #b91c1c; font-size: .85rem; }
.progstrip { display: flex; align-items: center; gap: 12px; padding: 10px 14px; margin: 0 0 16px; background: var(--mat-sys-surface, #fff); border: 1px solid rgba(0,0,0,.08); border-radius: 10px; cursor: pointer; }
    .progstrip:hover { background: rgba(37,99,235,.04); }
    .ps-bar { flex: 1; height: 8px; background: #eceff3; border-radius: 5px; overflow: hidden; }
    .ps-fill { height: 100%; background: #2563eb; border-radius: 5px; transition: width .5s ease; }
    .ps-pct { font-weight: 700; color: #111827; }
    .ps-meta { color: #6b7280; font-size: .82rem; }
    .ps-link { display: inline-flex; align-items: center; color: #2563eb; font-size: .82rem; font-weight: 600; }
    .ps-link mat-icon { font-size: 18px; height: 18px; width: 18px; }
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
    .viewer-tools { display: flex; justify-content: flex-end; margin-bottom: 8px; }
    .iso-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid rgba(37,99,235,.4); background: var(--mat-sys-surface, #fff); color: #2563eb; border-radius: 8px; font-size: .82rem; font-weight: 600; cursor: pointer; }
    .iso-btn:hover { background: rgba(37,99,235,.06); }
    .iso-btn.on { background: #2563eb; color: #fff; border-color: #2563eb; }
    .iso-btn:disabled { opacity: .5; cursor: default; }
    .iso-btn mat-icon { font-size: 18px; height: 18px; width: 18px; }
    .qa { margin-top: 12px; background: var(--mat-sys-surface, #fff); border: 1px solid rgba(0,0,0,.08); border-radius: 10px; padding: 12px; }
    .qa-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .qa-ico { color: #2563eb; font-size: 20px; height: 20px; width: 20px; }
    .qa-title { font-weight: 600; font-size: .9rem; color: #111827; flex: 1; }
    .qa-badge { padding: 1px 8px; border-radius: 999px; font-size: .72rem; font-weight: 700; text-transform: capitalize; color: #fff; }
    .qa-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .qbtn { border: 1px solid rgba(0,0,0,.15); background: var(--mat-sys-surface, #fff); border-radius: 8px; padding: 5px 10px; font-size: .8rem; font-weight: 600; cursor: pointer; color: #374151; }
    .qbtn:hover { background: rgba(0,0,0,.03); }
    .qbtn:disabled { opacity: .5; cursor: default; }
    .qbtn.pass { color: #047857; border-color: rgba(4,120,87,.4); }
    .qbtn.warn { color: #b45309; border-color: rgba(180,83,9,.4); }
    .qbtn.fail { color: #b91c1c; border-color: rgba(185,28,28,.4); }
    .qbtn.ncr { color: #1d4ed8; border-color: rgba(29,78,216,.4); }
    .qa-form { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; padding: 8px; background: rgba(0,0,0,.02); border-radius: 8px; }
    .qa-form input, .qa-form select, .qa-form textarea { padding: 6px 8px; border: 1px solid rgba(0,0,0,.15); border-radius: 6px; font-size: .82rem; }
    .qa-form input[type=number] { width: 84px; }
    .qa-form .grow { flex: 1; min-width: 140px; }
    .qa-form textarea { width: 100%; min-height: 46px; }
    .qa-form-row { display: flex; align-items: center; gap: 8px; width: 100%; }
    .qa-hint { color: #6b7280; font-size: .76rem; margin: 4px 0; }
    .qa-msg { color: #047857; font-size: .8rem; margin: 4px 0; font-weight: 600; }
    .qa-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .qa-item { display: flex; align-items: center; gap: 8px; font-size: .82rem; padding: 6px 8px; border: 1px solid rgba(0,0,0,.06); border-radius: 8px; }
    .qa-dot, .qa-tdot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
    .qa-tdot { margin-left: 6px; }
    .qa-st { text-transform: capitalize; color: #374151; }
    .qa-meta { color: #6b7280; }
    .qa-spacer { flex: 1; }
    .qa-when { color: #9ca3af; font-size: .75rem; }
    .qlink { background: none; border: none; color: #1d4ed8; font-weight: 600; cursor: pointer; font-size: .8rem; }
    .qb-pass { background: #10b981; }
    .qb-warning { background: #f59e0b; }
    .qb-fail { background: #ef4444; }
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
export class ProjectDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private svc = inject(ProjectsService);
  private dialog = inject(MatDialog);

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
  modelPending = false;
  prog: ProjectProgress | null = null;
  private pollTimer: any = null;

  processes: { id: string; name: string }[] = [];
  selectedProcessId = '';
  generating = false;
  recomputing = false;
  savingProcess = false;
  genMsg: string | null = null;
  isolate = false;            // when on, the viewer shows ONLY the selected node's GLB
  selectedNodeId: string | null = null;
  // ── Quality (selected node) ──
  qaList: QualityEntry[] = [];
  qaLoading = false;
  qaBusy = false;
  qaMsg: string | null = null;
  qaMeasureOpen = false;
  qaNcrOpen = false;
  qaSummary: ProjectQualitySummary | null = null;
  meas: { value: number | null; unit: string; min: number | null; max: number | null; notes: string } = { value: null, unit: 'mm', min: null, max: null, notes: '' };
  ncr: { title: string; severity: QaSeverity; description: string; qualityDataId?: string } = { title: '', severity: 'medium', description: '' };

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
    this.svc.listProcesses().subscribe({ next: (p) => (this.processes = p), error: () => {} });
  }

  load(): void {
    this.loading = true;
    // Link any large-file GLBs whose queued conversion has finished, then fetch.
    this.svc.resolveModels(this.id).subscribe({
      next: (r) => { this.modelPending = (r?.pending ?? 0) > 0; this.fetch(); if (this.modelPending) this.startGlbPoll(); },
      error: () => { this.fetch(); },
    });
  }

  private fetch(): void {
    this.svc.get(this.id).subscribe({
      next: (p) => { this.project = p; },
      error: () => { this.project = null; this.loading = false; },
    });
    this.svc.nodes(this.id).subscribe({
      next: (n) => { this.setNodes(n); this.loading = false; },
      error: () => { this.loading = false; },
    });
    this.svc.getProgress(this.id).subscribe({ next: (g) => (this.prog = g), error: () => {} });
    this.loadQualitySummary();
  }

  ngOnDestroy(): void { this.stopGlbPoll(); }

  /** While a GLB is converting, poll resolve-models so the viewer appears on its own. */
  private startGlbPoll(): void {
    if (this.pollTimer) return;
    let tries = 0;
    this.pollTimer = setInterval(() => {
      tries++;
      this.svc.resolveModels(this.id).subscribe({
        next: (r) => {
          this.modelPending = (r?.pending ?? 0) > 0;
          if ((r?.linked ?? 0) > 0) this.fetch();
          if (!this.modelPending || tries >= 20) this.stopGlbPoll();
        },
        error: () => this.stopGlbPoll(),
      });
    }, 6000);
  }

  private stopGlbPoll(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
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
    // Isolation: stream only the selected node's geometry from the per-part endpoint.
    const sel = this.selectedNodeId ? this.byId.get(this.selectedNodeId) : null;
    if (this.isolate && sel?.modelId) {
      return this.svc.nodeGlbUrl(this.id, sel.id);
    }
    const withModel = this.nodes.find((n) => n.modelId);
    return withModel?.modelId ? `${environment.apiUrl}/models/${withModel.modelId}/file` : null;
  }

  /** A node can be isolated only once it's selected and has a linked GLB. */
  canIsolate(): boolean {
    const sel = this.selectedNodeId ? this.byId.get(this.selectedNodeId) : null;
    return !!sel?.modelId;
  }

  toggleIsolate(): void {
    if (!this.isolate && !this.canIsolate()) return;
    this.isolate = !this.isolate;
  }

  // ── Quality ──
  selectedNodeName(): string {
    const s = this.selectedNodeId ? this.byId.get(this.selectedNodeId) : null;
    return s ? (s.mark || s.name) : '';
  }
  qaNodeStatus(): QaStatus | null {
    if (!this.selectedNodeId) return null;
    return this.qaSummary?.nodes[this.selectedNodeId]?.status ?? null;
  }
  qaNodeOpenNcr(): number {
    if (!this.selectedNodeId) return 0;
    return this.qaSummary?.nodes[this.selectedNodeId]?.openNcr ?? 0;
  }
  /** Small per-node tree badge: explicit status, or 'fail' if it has an open NCR. */
  qaDot(n: AssemblyNode): QaStatus | null {
    const e = this.qaSummary?.nodes[n.id];
    if (!e) return null;
    return e.status ?? (e.openNcr > 0 ? 'fail' : null);
  }
  private loadQualitySummary(): void {
    this.svc.qualitySummary(this.id).subscribe({ next: (s) => (this.qaSummary = s), error: () => {} });
  }
  private loadNodeQuality(): void {
    this.qaMeasureOpen = false; this.qaNcrOpen = false; this.qaMsg = null;
    if (!this.selectedNodeId) { this.qaList = []; return; }
    this.qaLoading = true;
    this.svc.nodeQuality(this.id, this.selectedNodeId).subscribe({
      next: (l) => { this.qaList = l; this.qaLoading = false; },
      error: () => { this.qaList = []; this.qaLoading = false; },
    });
  }
  recordQuick(status: QaStatus): void {
    if (!this.selectedNodeId || this.qaBusy) return;
    this.qaBusy = true; this.qaMsg = null;
    this.svc.recordQuality(this.id, this.selectedNodeId, { status }).subscribe({
      next: () => { this.qaBusy = false; this.qaMsg = 'Recorded: ' + status; this.loadNodeQuality(); this.loadQualitySummary(); },
      error: (e) => { this.qaBusy = false; this.qaMsg = e?.error?.message || 'Could not record.'; },
    });
  }
  recordMeasure(): void {
    if (!this.selectedNodeId || this.meas.value == null || this.qaBusy) return;
    this.qaBusy = true; this.qaMsg = null;
    const body: RecordQuality = {
      status: 'pass',
      measurementValue: this.meas.value,
      measurementUnit: this.meas.unit || undefined,
      toleranceMin: this.meas.min ?? undefined,
      toleranceMax: this.meas.max ?? undefined,
      notes: this.meas.notes || undefined,
    };
    this.svc.recordQuality(this.id, this.selectedNodeId, body).subscribe({
      next: (q) => {
        this.qaBusy = false; this.qaMeasureOpen = false;
        this.meas = { value: null, unit: 'mm', min: null, max: null, notes: '' };
        this.qaMsg = 'Recorded ' + q.status + (q.measurementValue != null ? ' (' + q.measurementValue + (q.measurementUnit || '') + ')' : '');
        this.loadNodeQuality(); this.loadQualitySummary();
      },
      error: (e) => { this.qaBusy = false; this.qaMsg = e?.error?.message || 'Could not record.'; },
    });
  }
  openNcr(): void {
    const s = this.selectedNodeId ? this.byId.get(this.selectedNodeId) : null;
    this.ncr = { title: s ? (s.mark || s.name) + ' — quality non-conformance' : 'Quality non-conformance', severity: 'medium', description: '', qualityDataId: undefined };
    this.qaNcrOpen = true; this.qaMeasureOpen = false; this.qaMsg = null;
  }
  openNcrFor(q: QualityEntry): void {
    const s = this.selectedNodeId ? this.byId.get(this.selectedNodeId) : null;
    this.ncr = {
      title: (s ? (s.mark || s.name) : 'Item') + ' — ' + (q.defectType || 'failed inspection'),
      severity: (q.severity as QaSeverity) || 'medium',
      description: q.notes || '',
      qualityDataId: q.id,
    };
    this.qaNcrOpen = true; this.qaMeasureOpen = false; this.qaMsg = null;
  }
  submitNcr(): void {
    if (!this.selectedNodeId || this.qaBusy) return;
    this.qaBusy = true; this.qaMsg = null;
    this.svc.raiseNodeNcr(this.id, this.selectedNodeId, {
      title: this.ncr.title || undefined,
      severity: this.ncr.severity,
      description: this.ncr.description || undefined,
      qualityDataId: this.ncr.qualityDataId,
    }).subscribe({
      next: (n) => { this.qaBusy = false; this.qaNcrOpen = false; this.qaMsg = 'Raised ' + n.number; this.loadQualitySummary(); },
      error: (e) => { this.qaBusy = false; this.qaMsg = e?.error?.message || 'Could not raise NCR.'; },
    });
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
    this.selectedNodeId = n.id;
    this.highlightGuids = this.descendantGuids(n);
    this.loadNodeQuality();
  }

  onMeshClicked(name: string): void {
    this.selectedGuid = name;
    this.highlightGuids = [name];
    const node = this.nodes.find((n) => n.ifcGuid === name);
    if (node) {
      this.selectedNodeId = node.id;
      let p = node.parentId;
      while (p) { this.collapsed.delete(p); p = this.byId.get(p)?.parentId ?? null; }
      this.loadNodeQuality();
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

  /** Open the edit dialog (name, job #, client, status, due date, process, description). */
  editProject(): void {
    if (!this.project) return;
    this.dialog.open(ProjectEditDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      data: { project: this.project },
    }).afterClosed().subscribe((updated: Project | undefined) => {
      if (updated) { this.project = updated; this.prog && this.svc.getProgress(this.id).subscribe({ next: (g) => (this.prog = g), error: () => {} }); }
    });
  }

  /** Attach or change the project's process (stage routing). */
  updateProcess(processId: string): void {
    if (!this.project) return;
    this.savingProcess = true;
    this.svc.update(this.id, { processId: processId || null }).subscribe({
      next: (p) => { this.project = p; this.savingProcess = false; },
      error: () => { this.savingProcess = false; },
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
