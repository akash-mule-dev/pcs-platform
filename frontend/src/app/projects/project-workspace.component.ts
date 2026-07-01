import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MODEL_UPLOAD_ACCEPT, fileAccept } from '../shared/upload-accept';
import { Subscription } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ProjectWorkspaceStore, IMPORT_STAGE_LABELS } from './project-workspace.store';
import { ProjectEditDialogComponent } from './project-edit-dialog.component';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { ProjectsService, Project } from '../core/services/projects.service';
import { PermissionsService } from '../core/services/permissions.service';
import { ToastService } from '../core/services/toast.service';
import { TourLauncherComponent } from '../shared/components/tour-launcher/tour-launcher.component';

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
    CommonModule, RouterModule, MatIconModule, MatMenuModule,
    MatTooltipModule, MatProgressBarModule, MatProgressSpinnerModule, MatDialogModule,
    TourLauncherComponent,
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
              </div>
            </div>

            <div class="actions">
              <app-tour-launcher tourId="project-workspace" [auto]="true" tooltip="Tour this project"></app-tour-launcher>
              <input #fileInput type="file" hidden [attr.accept]="acceptModel" (change)="onFile($event)">
              <button class="act-btn primary" data-tour="ws-import" (click)="fileInput.click()" [disabled]="store.importing()">
                <mat-icon>upload_file</mat-icon><span>Import Package</span>
              </button>
              <button class="act-btn" (click)="editProject()"><mat-icon>edit</mat-icon><span>Edit</span></button>
              <button class="act-icon" [matMenuTriggerFor]="more" matTooltip="More actions"><mat-icon>more_vert</mat-icon></button>
              <mat-menu #more="matMenu">
                <button mat-menu-item (click)="store.reload()"><mat-icon>refresh</mat-icon><span>Reload</span></button>
                @if (perms.can('projects.delete')) {
                  <button mat-menu-item class="danger-item" (click)="deleteProject()"><mat-icon>delete</mat-icon><span>Delete project</span></button>
                }
              </mat-menu>
            </div>
          </div>

          @if (store.importing()) {
            <div class="import-bar">
              <mat-progress-bar mode="determinate" [value]="store.uploadProgress()"></mat-progress-bar>
              <span class="import-hint">Uploading… {{ store.uploadProgress() }}% — the file is stored safely before processing begins</span>
            </div>
          } @else {
            @if (store.currentImport(); as imp) {
              <div class="import-bar">
                <mat-progress-bar mode="determinate" [value]="imp.progress"></mat-progress-bar>
                <span class="import-hint">
                  <span class="pl-stage">{{ stageLabel(imp.stage) }}</span> · {{ imp.progress }}%
                  @if (store.pipelineMessage(); as msg) { <span class="pl-msg">— {{ msg }}</span> }
                  <a class="pl-link" [routerLink]="['/projects', store.id(), 'monitoring']">View pipeline</a>
                </span>
              </div>
            }
          }
          @if (store.importError()) { <p class="import-err">{{ store.importError() }}</p> }

          <!-- Revision review banner: shown while the latest revision is unreviewed -->
          @if (store.revisionStatus(); as rev) {
            @if (rev.hasUnreviewed) {
              <div class="rev-banner">
                <mat-icon class="rb-icon">difference</mat-icon>
                <div class="rb-text">
                  <strong>New revision uploaded{{ rev.latestImportName ? ' — ' + rev.latestImportName : '' }}</strong>
                  <span class="rb-sub">
                    @if (rev.counts.changed) { <span class="rb-chip chg">~{{ rev.counts.changed }} changed</span> }
                    @if (rev.counts.added) { <span class="rb-chip add">+{{ rev.counts.added }} new</span> }
                    @if (rev.counts.missing) { <span class="rb-chip del">−{{ rev.counts.missing }} removed</span> }
                    @if (rev.impact.pieces > 0) {
                      <span class="rb-impact">
                        {{ rev.impact.pieces }} piece(s) in production
                        @if (rev.impact.critical) { <span class="rb-sev crit">{{ rev.impact.critical }} shipped</span> }
                        @if (rev.impact.high) { <span class="rb-sev high">{{ rev.impact.high }} with work done</span> }
                      </span>
                    }
                  </span>
                </div>
                <div class="rb-actions">
                  <a class="rb-review" [routerLink]="['/projects', store.id(), 'monitoring']">Review changes</a>
                  <button class="rb-ack" (click)="markRevisionReviewed()" [disabled]="!rev.latestImportId">Mark reviewed</button>
                </div>
              </div>
            }
          }

          <!-- Design stat strip (production tracking lives inside each work order) -->
          <div class="stat-strip" data-tour="ws-stats">
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
        <nav class="tab-bar" data-tour="ws-tabs">
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
    .import-hint { font-size: 12px; color: var(--clay-text-muted); display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .pl-stage { font-weight: 700; color: var(--clay-primary); }
    .pl-msg { color: var(--clay-text-muted); }
    .pl-link { margin-left: 8px; font-weight: 600; color: var(--clay-primary); text-decoration: underline; cursor: pointer; }
    .import-err { background: var(--clay-surface); border-left: 1px solid var(--clay-border); border-right: 1px solid var(--clay-border); margin: 0; padding: 8px 20px; color: var(--danger-text); font-size: 13px; }

    /* ── Revision review banner ────────────────────────────────────── */
    .rev-banner {
      display: flex; align-items: center; gap: 12px;
      background: var(--warning-bg, #fff7e6); border-left: 3px solid var(--warning, #f59e0b);
      border-right: 1px solid var(--clay-border);
      padding: 10px 20px;
    }
    .rb-icon { color: var(--warning, #f59e0b); flex-shrink: 0; }
    .rb-text { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
    .rb-text strong { font-size: 13px; color: var(--clay-text); }
    .rb-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: var(--clay-text-muted); }
    .rb-chip { border-radius: 999px; padding: 1px 8px; font-weight: 700; font-size: 11px; }
    .rb-chip.add { background: #e7f7ee; color: #1a7f43; }
    .rb-chip.chg { background: #fdf1dc; color: #9a6700; }
    .rb-chip.del { background: #fdecec; color: #b42318; }
    .rb-impact { display: inline-flex; align-items: center; gap: 6px; margin-left: 4px; }
    .rb-sev { border-radius: 999px; padding: 1px 8px; font-weight: 700; font-size: 11px; }
    .rb-sev.crit { background: #b42318; color: #fff; }
    .rb-sev.high { background: #fdecec; color: #b42318; }
    .rb-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .rb-review { font-size: 13px; font-weight: 600; color: var(--clay-primary); text-decoration: underline; cursor: pointer; }
    .rb-ack {
      border: 1px solid var(--warning, #f59e0b); background: var(--warning, #f59e0b); color: #fff;
      border-radius: var(--clay-radius-sm); padding: 6px 12px; font-size: 12px; font-weight: 700;
      cursor: pointer; font-family: inherit; white-space: nowrap;
    }
    .rb-ack:hover { filter: brightness(1.05); }
    .rb-ack:disabled { opacity: .55; cursor: default; }

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
  /** Desktop accept filter; dropped on iOS so WebKit doesn't grey out .ifc/.step files. */
  readonly acceptModel = fileAccept(MODEL_UPLOAD_ACCEPT);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private svc = inject(ProjectsService);
  private toast = inject(ToastService);
  perms = inject(PermissionsService);
  store = inject(ProjectWorkspaceStore);

  private sub?: Subscription;

  readonly tabs: WorkspaceTab[] = [
    { path: 'overview', label: 'Overview', icon: 'dashboard' },
    { path: 'assemblies', label: 'Assemblies & 3D', icon: 'account_tree' },
    { path: 'materials', label: 'Materials', icon: 'category' },
    { path: 'orders', label: 'Work Orders', icon: 'receipt_long' },
    { path: 'monitoring', label: 'Monitoring', icon: 'monitor_heart' },
    { path: 'reports', label: 'Reports', icon: 'payments' },
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
    if (path === 'monitoring') { const c = this.store.activeImports().length; return c > 0 ? c : null; }
    return null;
  }

  stageLabel(stage: string): string {
    return IMPORT_STAGE_LABELS[stage] ?? stage;
  }

  /** One-click: mark the whole latest revision reviewed (clears banner + badges). */
  markRevisionReviewed(): void {
    const importId = this.store.revisionStatus()?.latestImportId;
    if (importId) this.store.acknowledgeRevision(importId);
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length ? input.files[0] : null;
    if (file) this.store.importIfc(file);
    input.value = '';
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
        message: `"${p.name}" will be moved to the Trash. You can restore it for 30 days from Projects → Recently deleted, after which it (and its assemblies, work orders and shipments) is permanently removed.`,
        confirmText: 'Delete project',
      },
    }).afterClosed().subscribe((ok: boolean) => {
      if (!ok) return;
      this.svc.remove(p.id).subscribe({
        next: () => { this.toast.success('Project moved to Trash — recoverable for 30 days'); this.router.navigate(['/projects']); },
        error: (e) => {
          // The project has work orders — the server blocks a plain delete (409).
          // Offer to remove them together (a permanent, non-recoverable cascade).
          if (e?.status === 409) { this.confirmCascadeDelete(p); return; }
          this.toast.error(e?.error?.message || 'Could not delete project');
        },
      });
    });
  }

  /** Second-step confirm: delete the project AND permanently remove its work orders. */
  private confirmCascadeDelete(p: Project): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete project and its work orders?',
        message: `"${p.name}" has work orders in production. Deleting will PERMANENTLY remove its work orders, stages, logged time, shipments and quality records (not recoverable), then move the project to the Trash (the design tree stays restorable for 30 days).`,
        confirmText: 'Delete everything',
      },
    }).afterClosed().subscribe((ok: boolean) => {
      if (!ok) return;
      this.svc.remove(p.id, true).subscribe({
        next: () => { this.toast.success('Project and its work orders deleted — project recoverable for 30 days'); this.router.navigate(['/projects']); },
        error: (e) => this.toast.error(e?.error?.message || 'Could not delete project'),
      });
    });
  }
}
