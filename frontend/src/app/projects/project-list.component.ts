import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProjectsService, Project, ProjectStatus } from '../core/services/projects.service';
import { ProjectWizardComponent } from './project-wizard.component';

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatDialogModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>Projects</h1>
          <p class="sub">Fabrication jobs — create one and upload an IFC to build its assembly tree.</p>
        </div>
        <button mat-flat-button color="primary" (click)="openWizard()">
          <mat-icon>add</mat-icon>&nbsp;New Project
        </button>
      </div>

      @if (loading) {
        <div class="center"><mat-spinner diameter="36"></mat-spinner></div>
      } @else if (projects.length === 0) {
        <div class="empty">
          <mat-icon>foundation</mat-icon>
          <p>No projects yet. Create one and upload an IFC file to get started.</p>
          <button mat-stroked-button color="primary" (click)="openWizard()">New Project</button>
        </div>
      } @else {
        <table class="grid">
          <thead>
            <tr><th>Name</th><th>Job #</th><th>Client</th><th>Status</th><th>Due</th></tr>
          </thead>
          <tbody>
            @for (p of projects; track p.id) {
              <tr (click)="open(p)">
                <td class="name">{{ p.name }}</td>
                <td>{{ p.projectNumber || '—' }}</td>
                <td>{{ p.clientName || '—' }}</td>
                <td><span class="chip" [class]="'st-' + p.status">{{ statusLabel(p.status) }}</span></td>
                <td>{{ p.dueDate ? (p.dueDate | date:'mediumDate') : '—' }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px; max-width: 1100px; margin: 0 auto; }
    .page-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; gap: 16px; }
    h1 { margin: 0; font-size: 1.5rem; }
    .sub { margin: 4px 0 0; color: var(--mat-sys-on-surface-variant, #6b7280); font-size: .9rem; }
    .center, .empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 64px 0; color: #6b7280; }
    .empty mat-icon { font-size: 48px; height: 48px; width: 48px; opacity: .5; }
    table.grid { width: 100%; border-collapse: collapse; background: var(--mat-sys-surface, #fff); border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .grid th, .grid td { text-align: left; padding: 12px 16px; border-bottom: 1px solid rgba(0,0,0,.06); font-size: .9rem; }
    .grid th { font-weight: 600; color: #6b7280; font-size: .8rem; text-transform: uppercase; letter-spacing: .03em; }
    .grid tbody tr { cursor: pointer; }
    .grid tbody tr:hover { background: rgba(0,0,0,.03); }
    .grid td.name { font-weight: 600; }
    .chip { padding: 2px 10px; border-radius: 999px; font-size: .78rem; font-weight: 600; }
    .st-planning { background: #eef2ff; color: #4338ca; }
    .st-active { background: #ecfdf5; color: #047857; }
    .st-on_hold { background: #fef3c7; color: #b45309; }
    .st-completed { background: #e0f2fe; color: #0369a1; }
    .st-archived { background: #f3f4f6; color: #6b7280; }
  `],
})
export class ProjectListComponent implements OnInit {
  private svc = inject(ProjectsService);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  projects: Project[] = [];
  loading = true;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.svc.list().subscribe({
      next: (p) => { this.projects = p; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  openWizard(): void {
    this.dialog.open(ProjectWizardComponent, { width: '640px', maxWidth: '95vw' })
      .afterClosed().subscribe((created: Project | undefined) => {
        if (created) {
          this.load();
          this.router.navigate(['/projects', created.id]);
        }
      });
  }

  open(p: Project): void {
    this.router.navigate(['/projects', p.id]);
  }

  statusLabel(s: ProjectStatus): string {
    return { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived' }[s] ?? s;
  }
}
