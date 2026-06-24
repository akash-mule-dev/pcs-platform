import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ProjectsService, DeletedProject } from '../core/services/projects.service';
import { PermissionsService } from '../core/services/permissions.service';
import { ToastService } from '../core/services/toast.service';
import { ConfirmDialogComponent } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { ListStateComponent } from '../shared/components/list-state/list-state.component';

/**
 * Recently deleted (Trash): projects soft-deleted within the 30-day recovery
 * window. Each can be restored (back to the portfolio) or permanently deleted
 * now. Anything left here is purged automatically once its countdown hits zero
 * (server-side retention sweep). Acting requires `projects.delete`.
 */
@Component({
  selector: 'app-project-trash',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatDialogModule, ListStateComponent],
  template: `
    <div class="trash">
      <div class="page-header">
        <div class="header-left">
          <a class="back" routerLink="/projects"><mat-icon>arrow_back</mat-icon>Projects</a>
          <h1 class="page-title">Recently deleted</h1>
          <p class="page-subtitle">Deleted projects are kept for 30 days, then permanently removed. Restore one to send it back to the portfolio.</p>
        </div>
      </div>

      <app-list-state [loading]="loading" [error]="error" (retry)="load()">
      @if (projects.length === 0) {
        <div class="empty-state">
          <mat-icon>delete_outline</mat-icon>
          <h3>Trash is empty</h3>
          <p>Projects you delete will appear here, recoverable for 30 days.</p>
          <a class="back-link" routerLink="/projects">Back to Projects</a>
        </div>
      } @else {
        <div class="proj-list">
          @for (p of projects; track p.id) {
            <div class="proj-row">
              <div class="col-id">
                <mat-icon class="p-ico">foundation</mat-icon>
                <div class="id-text">
                  <span class="p-name">{{ p.name }}</span>
                  <span class="p-sub">
                    @if (p.projectNumber) { <span class="mono">{{ p.projectNumber }}</span> }
                    @if (p.projectNumber && p.clientName) { <span class="dotsep">·</span> }
                    @if (p.clientName) { <span>{{ p.clientName }}</span> }
                    @if (!p.projectNumber && !p.clientName) { <span class="muted">No job # · no client</span> }
                  </span>
                </div>
              </div>

              <div class="col-when">
                <span class="m"><mat-icon>delete</mat-icon>Deleted {{ p.deletedAt | date:'mediumDate' }}</span>
                <span class="countdown" [class.urgent]="p.daysRemaining <= 3">
                  <mat-icon>timer</mat-icon>
                  @if (p.daysRemaining > 0) { {{ p.daysRemaining }} day{{ p.daysRemaining === 1 ? '' : 's' }} left }
                  @else { Purging soon }
                </span>
              </div>

              @if (perms.can('projects.delete')) {
                <div class="col-actions">
                  <button class="btn restore" [disabled]="busy.has(p.id)" (click)="restore(p)">
                    <mat-icon>restore</mat-icon>Restore
                  </button>
                  <button class="btn danger" [disabled]="busy.has(p.id)" (click)="purge(p)">
                    <mat-icon>delete_forever</mat-icon>Delete permanently
                  </button>
                </div>
              }
            </div>
          }
        </div>
      }
      </app-list-state>
    </div>
  `,
  styles: [`
    .trash { max-width: 1100px; margin: 0 auto; }
    .page-header { margin-bottom: 18px; }
    .back { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 600; color: var(--clay-text-muted); text-decoration: none; margin-bottom: 6px; }
    .back:hover { color: var(--clay-primary); }
    .back mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .page-title { margin: 0; font-size: 22px; font-weight: 700; color: var(--clay-text); }
    .page-subtitle { margin: 4px 0 0; font-size: 13px; color: var(--clay-text-muted); }

    .empty-state { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 56px 20px; text-align: center; color: var(--clay-text-muted); }
    .empty-state mat-icon { font-size: 44px; width: 44px; height: 44px; opacity: .5; }
    .empty-state h3 { margin: 8px 0 0; color: var(--clay-text); }
    .empty-state p { margin: 0; font-size: 13px; }
    .back-link { margin-top: 12px; color: var(--clay-primary); font-weight: 600; font-size: 13px; text-decoration: none; }

    .proj-list {
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius); overflow: hidden; box-shadow: var(--clay-shadow-soft);
    }
    .proj-row {
      display: grid; grid-template-columns: minmax(200px, 1.6fr) minmax(180px, 1fr) auto;
      align-items: center; gap: 18px; padding: 14px 18px; border-bottom: 1px solid var(--clay-border);
    }
    .proj-row:last-child { border-bottom: none; }
    .col-id { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .p-ico { font-size: 20px; width: 20px; height: 20px; color: var(--clay-text-muted); flex-shrink: 0; }
    .id-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .p-name { font-weight: 600; font-size: 14px; color: var(--clay-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .p-sub { font-size: 12px; color: var(--clay-text-muted); display: flex; align-items: center; gap: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .p-sub .mono { font-family: 'Space Grotesk', monospace; }
    .p-sub .muted { opacity: .7; }
    .dotsep { opacity: .5; }

    .col-when { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .m { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--clay-text-secondary); white-space: nowrap; }
    .m mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--clay-text-muted); }
    .countdown { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--clay-text-secondary); white-space: nowrap; }
    .countdown mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--clay-text-muted); }
    .countdown.urgent { color: var(--danger-text); }
    .countdown.urgent mat-icon { color: var(--danger-text); }

    .col-actions { display: inline-flex; align-items: center; gap: 8px; justify-content: flex-end; }
    .btn {
      display: inline-flex; align-items: center; gap: 5px; border-radius: var(--clay-radius-sm);
      padding: 7px 13px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit;
      border: 1px solid var(--clay-border); background: var(--clay-surface); color: var(--clay-text-secondary); transition: all .15s;
    }
    .btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .btn:disabled { opacity: .55; cursor: default; }
    .btn.restore:hover:not(:disabled) { border-color: var(--clay-primary); color: var(--clay-primary); background: var(--info-bg); }
    .btn.danger { border-color: var(--danger); color: var(--danger-text); }
    .btn.danger:hover:not(:disabled) { background: var(--danger-bg); }

    @media (max-width: 820px) {
      .proj-row { grid-template-columns: 1fr; gap: 10px; }
      .col-actions { justify-content: flex-start; }
    }
  `],
})
export class ProjectTrashComponent implements OnInit {
  private svc = inject(ProjectsService);
  private dialog = inject(MatDialog);
  private toast = inject(ToastService);
  perms = inject(PermissionsService);

  projects: DeletedProject[] = [];
  loading = true;
  error: string | null = null;
  busy = new Set<string>();

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = null;
    this.svc.listDeleted().subscribe({
      next: (p) => { this.projects = p; this.loading = false; },
      error: () => { this.loading = false; this.error = 'Could not load the Trash. Check your connection and try again.'; },
    });
  }

  restore(p: DeletedProject): void {
    this.busy.add(p.id);
    this.svc.restore(p.id).subscribe({
      next: () => {
        this.busy.delete(p.id);
        this.toast.success(`"${p.name}" restored`);
        this.projects = this.projects.filter((x) => x.id !== p.id);
      },
      error: (e) => { this.busy.delete(p.id); this.toast.error(e?.error?.message || 'Could not restore project'); },
    });
  }

  purge(p: DeletedProject): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete permanently?',
        message: `"${p.name}" and everything it contains — assemblies, work orders, quality records, shipments and uploaded files — will be permanently deleted. This CANNOT be undone.`,
        confirmText: 'Delete permanently',
      },
    }).afterClosed().subscribe((ok: boolean) => {
      if (!ok) return;
      this.busy.add(p.id);
      this.svc.purge(p.id).subscribe({
        next: () => {
          this.busy.delete(p.id);
          this.toast.success(`"${p.name}" permanently deleted`);
          this.projects = this.projects.filter((x) => x.id !== p.id);
        },
        error: (e) => { this.busy.delete(p.id); this.toast.error(e?.error?.message || 'Could not delete project'); },
      });
    });
  }
}
