import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { ProjectEditDialogComponent } from './project-edit-dialog.component';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { ProjectsService, Project } from '../core/services/projects.service';

interface WorkspaceTab { path: string; label: string; icon: string; }

/**
 * Project workspace shell — the project is a PURE design container: identity
 * header + design stat strip + tabs (Overview / Assemblies & 3D / Work Orders)
 * in a router-outlet. Production tracking (board, progress, quality, shipping)
 * lives inside each work order at orders/:orderId. All tabs share the
 * route-scoped ProjectWorkspaceStore.
 */
@Component({
  selector: 'app-project-workspace',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule, MatIconModule, MatMenuModule,
    MatTooltipModule, MatProgressBarModule, MatProgressSpinnerModule, MatDialogModule,
  ],
  template: `
    <div class="ws">
      <header class="ws-header">
        <a class="breadcrumb" routerLink="/projects"><mat-icon>arrow_back</mat-icon><span>Projects</span></a>

        @if (store.project(); as p) {
          <div class="identity">
            <div class="id-main">
              <div class="title-row">
                <h1>{{ p.name }}</h1>
              </div>
              <div class="meta-row">
                @if (p.projectNumber) { <span class="meta"><mat-icon>tag</mat-icon>{{ p.projectNumber }}</span> }
                @if (p.clientName) { <span class="meta"><mat-icon>business</mat-icon>{{ p.clientName }}</span> }
                <span class="meta proc">
                  <mat-icon>account_tree</mat-icon>
                  <select [ngModel]="p.processId || ''" (ngModelChange)="updateProcess($event)" [disabled]="savingProcess">
                    <option value="">No process</option>
                    @for (pr of store.processes(); track pr.id) { <option [value]="pr.id">{{ pr.name }}</option> }
                  </select>
                  @if (savingProcess) { <span class="saving">saving…</span> }
                </span>
              </div>
            </div>

            <div class="actions">
              <input #fileInput type="file" hidden accept=".ifc" (change)="onFile($event)">
              <button class="act-btn primary" (click)="fileInput.click()" [disabled]="store.importing()">
                <mat-icon>upload_file</mat-icon><span>Import IFC</span>
              </button>
              <button class="act-btn" (click)="editProject()"><mat-icon>edit</mat-icon><span>Edit</span></button>
              <button class="act-icon" [matMenuTriggerFor]="more" matTooltip="More actions"><mat-icon>more_vert</mat-icon></button>
              <mat-menu #more="matMenu">
                <button mat-menu-item (click)="store.reload()"><mat-icon>refresh</mat-icon><span>Reload</span></button>
                <button mat-menu-item class="danger-item" (click)="deleteProject()"><mat-icon>delete</mat-icon><span>Delete project</span></button>
              </mat-menu>
            </div>
          </div>

          @if (store.importing()) {
            <div class="import-bar">
              <mat-progress-bar [mode]="store.uploadProgress() < 100 ? 'determinate' : 'indeterminate'" [value]="store.uploadProgress()"></mat-progress-bar>
              <span class="import-hint">{{ store.uploadProgress() < 100 ? 'Uploading ' + store.uploadProgress() + '%' : 'Extracting assembly structure…' }}</span>
            </div>
          }
          @if (store.importError()) { <p class="import-err">{{ store.importError() }}</p> }

          <!-- Design stat strip (production tracking lives inside each work order) -->
          <div class="stat-strip">
            <div class="stat">
              <span class="stat-num">{{ store.progress()?.nodes?.assembly ?? 0 }}<em>+{{ store.progress()?.nodes?.subassembly ?? 0 }}</em></span>
              <span class="stat-lbl">Assemblies</span>
            </div>
            <div class="stat">
              <span class="stat-num">{{ store.progress()?.nodes?.part ?? 0 }}</span>
              <span class="stat-lbl">Parts</span>
            </div>
            <div class="divider"></div>
            <div class="stat">
              <span class="stat-num">{{ tonnes(store.progress()?.tonnage?.totalKg) }}<em> t</em></span>
              <span class="stat-lbl">Total weight</span>
            </div>
            <div class="stat">
              <span class="stat-num">{{ store.ordersCount() }}</span>
              <span class="stat-lbl">Work orders</span>
            </div>
            <div class="stat">
              <span class="stat-num">{{ store.progress()?.workOrders ?? 0 }}</span>
              <span class="stat-lbl">Items in production</span>
            </div>
          </div>
        } @else if (store.loading()) {
          <div class="head-skeleton"><mat-spinner diameter="28"></mat-spinner></div>
        }

        <!-- Tab bar -->
        <nav class="tab-bar">
          @for (t of tabs; track t.path) {
            <a class="tab" [routerLink]="['/projects', store.id(), t.path]" routerLinkActive="active">
              <mat-icon>{{ t.icon }}</mat-icon>
              <span>{{ t.label }}</span>
              @if (tabBadge(t.path); as b) { <span class="tab-badge">{{ b }}</span> }
            </a>
          }
        </nav>
      </header>

      <div class="ws-body">
        @if (store.notFound()) {
          <div class="empty-state">
            <mat-icon>search_off</mat-icon>
            <h3>Project not found</h3>
            <p>It may have been deleted. <a routerLink="/projects">Back to projects</a></p>
          </div>
        } @else {
          <router-outlet></router-outlet>
        }
      </div>
    </div>
  `,
  styles: [`
    .ws { max-width: 1320px; margin: 0 auto; }

    /* ── Sticky header ─────────────────────────────────────────────── */
    .ws-header {
      position: sticky; top: -24px; z-index: 20;
      background: var(--clay-bg);
      padding-top: 4px; margin: -4px 0 20px;
    }
    .breadcrumb {
      display: inline-flex; align-items: center; gap: 4px;
      color: var(--clay-text-muted); font-size: 13px; font-weight: 500;
      margin-bottom: 12px; transition: color .15s;
    }
    .breadcrumb:hover { color: var(--clay-primary); }
    .breadcrumb mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .head-skeleton { display: flex; align-items: center; padding: 24px 0; }

    .identity {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius) var(--clay-radius) 0 0;
      border-bottom: none; padding: 18px 20px 16px;
    }
    .title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .title-row h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--clay-text); }

    .meta-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; margin-top: 8px; }
    .meta { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: var(--clay-text-secondary); }
    .meta mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--clay-text-muted); }
    .meta.proc select {
      border: 1px solid var(--clay-border); border-radius: var(--clay-radius-xs);
      background: var(--clay-surface); color: var(--clay-text);
      padding: 3px 8px; font-size: 12px; font-family: inherit; cursor: pointer;
    }
    .meta.proc .saving { font-size: 11px; color: var(--clay-text-muted); }

    .actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .act-btn {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1px solid var(--clay-border); background: var(--clay-surface);
      color: var(--clay-text-secondary); border-radius: var(--clay-radius-sm);
      padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      font-family: inherit; transition: all .15s; white-space: nowrap;
    }
    .act-btn:hover { border-color: var(--clay-primary); color: var(--clay-primary); background: var(--info-bg); }
    .act-btn.primary { background: var(--clay-primary); color: #fff; border-color: var(--clay-primary); }
    .act-btn.primary:hover { filter: brightness(1.08); color: #fff; }
    .act-btn:disabled { opacity: .55; cursor: default; }
    .act-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .act-icon {
      width: 36px; height: 36px; border-radius: var(--clay-radius-sm);
      border: 1px solid var(--clay-border); background: var(--clay-surface);
      color: var(--clay-text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all .15s;
    }
    .act-icon:hover { color: var(--clay-text); background: var(--clay-surface-hover); }
    ::ng-deep .danger-item { color: var(--danger) !important; }
    ::ng-deep .danger-item mat-icon { color: var(--danger) !important; }

    .import-bar { background: var(--clay-surface); border-left: 1px solid var(--clay-border); border-right: 1px solid var(--clay-border); padding: 8px 20px 4px; }
    .import-hint { font-size: 12px; color: var(--clay-text-muted); }
    .import-err { background: var(--clay-surface); border-left: 1px solid var(--clay-border); border-right: 1px solid var(--clay-border); margin: 0; padding: 8px 20px; color: var(--danger-text); font-size: 13px; }

    /* ── Stat strip ────────────────────────────────────────────────── */
    .stat-strip {
      display: flex; align-items: stretch; gap: 22px; flex-wrap: wrap;
      background: var(--clay-surface); border: 1px solid var(--clay-border); border-top: none;
      padding: 12px 20px;
    }
    .stat { display: flex; flex-direction: column; gap: 2px; justify-content: center; min-width: 76px; }
    .stat-num { font-size: 18px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; line-height: 1.1; }
    .stat-num em { font-style: normal; font-size: 12px; font-weight: 500; color: var(--clay-text-muted); margin-left: 1px; }
    .stat-lbl { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--clay-text-muted); }
    .divider { width: 1px; background: var(--clay-border); align-self: stretch; }

    /* ── Tab bar ───────────────────────────────────────────────────── */
    .tab-bar {
      display: flex; gap: 2px; flex-wrap: wrap;
      background: var(--clay-surface); border: 1px solid var(--clay-border); border-top: none;
      border-radius: 0 0 var(--clay-radius) var(--clay-radius);
      padding: 0 8px;
    }
    .tab {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 12px 14px 11px; font-size: 13px; font-weight: 600;
      color: var(--clay-text-muted); border-bottom: 2.5px solid transparent;
      cursor: pointer; transition: color .15s; white-space: nowrap;
    }
    .tab:hover { color: var(--clay-text); }
    .tab mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .tab.active { color: var(--clay-primary); border-bottom-color: var(--clay-primary); }
    .tab-badge {
      background: var(--clay-bg-warm); color: var(--clay-text-secondary);
      border-radius: 999px; padding: 1px 7px; font-size: 11px; font-weight: 700; min-width: 18px; text-align: center;
    }
    .tab.active .tab-badge { background: var(--info-bg); color: var(--clay-primary); }

    .ws-body { min-height: 200px; }

    @media (max-width: 720px) {
      .identity { flex-direction: column; }
      .actions { width: 100%; }
      .stat-strip { gap: 14px; }
      .divider { display: none; }
    }
  `],
})
export class ProjectWorkspaceComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private svc = inject(ProjectsService);
  store = inject(ProjectWorkspaceStore);

  savingProcess = false;
  private sub?: Subscription;

  readonly tabs: WorkspaceTab[] = [
    { path: 'overview', label: 'Overview', icon: 'dashboard' },
    { path: 'assemblies', label: 'Assemblies & 3D', icon: 'account_tree' },
    { path: 'orders', label: 'Work Orders', icon: 'receipt_long' },
  ];

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((pm) => this.store.init(pm.get('id') ?? ''));
  }
  ngOnDestroy(): void { this.sub?.unsubscribe(); this.store.stopPoll(); }

  tonnes(kg: number | null | undefined): string {
    const t = (kg ?? 0) / 1000;
    return t >= 100 ? Math.round(t).toString() : (Math.round(t * 10) / 10).toString();
  }

  tabBadge(path: string): number | null {
    if (path === 'assemblies') { const c = this.store.nodes().length; return c > 0 ? c : null; }
    if (path === 'orders') { const c = this.store.ordersCount(); return c > 0 ? c : null; }
    return null;
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length ? input.files[0] : null;
    if (file) this.store.importIfc(file);
    input.value = '';
  }

  updateProcess(processId: string): void {
    const p = this.store.project();
    if (!p) return;
    this.savingProcess = true;
    this.svc.update(p.id, { processId: processId || null }).subscribe({
      next: (updated) => { this.store.setProject(updated); this.savingProcess = false; },
      error: () => { this.savingProcess = false; },
    });
  }

  editProject(): void {
    const p = this.store.project();
    if (!p) return;
    this.dialog.open(ProjectEditDialogComponent, { width: '640px', maxWidth: '95vw', data: { project: p } })
      .afterClosed().subscribe((updated: Project | undefined) => {
        if (updated) { this.store.setProject(updated); this.store.refreshProgress(); }
      });
  }

  deleteProject(): void {
    const p = this.store.project();
    if (!p) return;
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete project?',
        message: `"${p.name}" and its assemblies, work orders and shipments will be permanently removed. This cannot be undone.`,
        confirmText: 'Delete project',
      },
    }).afterClosed().subscribe((ok: boolean) => {
      if (ok) this.svc.remove(p.id).subscribe({ next: () => this.router.navigate(['/projects']), error: () => {} });
    });
  }
}
