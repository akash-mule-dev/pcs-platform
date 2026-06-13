import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProjectsService, ProjectSummary } from '../core/services/projects.service';
import { ProjectWizardComponent } from './project-wizard.component';

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule, MatDialogModule, MatProgressSpinnerModule],
  template: `
    <div class="portfolio">
      <div class="page-header">
        <div class="header-left">
          <h1 class="page-title">Projects</h1>
          <p class="page-subtitle">Fabrication jobs across the shop — track production, tonnage and shipping at a glance.</p>
        </div>
        <div class="header-actions">
          <a class="monitor-btn" routerLink="/package-monitor" title="Live import pipeline + package history across all projects">
            <mat-icon>monitor_heart</mat-icon>Package Monitor
          </a>
          <button class="new-btn" (click)="openWizard()"><mat-icon>add</mat-icon>New Project</button>
        </div>
      </div>

      @if (loading) {
        <div class="center"><mat-spinner diameter="36"></mat-spinner></div>
      } @else if (projects.length === 0) {
        <div class="empty-state">
          <mat-icon>foundation</mat-icon>
          <h3>No projects yet</h3>
          <p>Create a project and upload an IFC file to build its assembly tree.</p>
          <button class="new-btn" (click)="openWizard()"><mat-icon>add</mat-icon>New Project</button>
        </div>
      } @else {
        <!-- KPI cards -->
        <div class="kpi-grid">
          <div class="kpi">
            <div class="kpi-icon tone-blue"><mat-icon>foundation</mat-icon></div>
            <div class="kpi-text"><span class="kpi-num">{{ projects.length }}</span><span class="kpi-lbl">Projects</span></div>
          </div>
          <div class="kpi">
            <div class="kpi-icon tone-green"><mat-icon>widgets</mat-icon></div>
            <div class="kpi-text"><span class="kpi-num">{{ totalAssemblies() }}</span><span class="kpi-lbl">Assemblies</span></div>
          </div>
          <div class="kpi">
            <div class="kpi-icon tone-orange"><mat-icon>square_foot</mat-icon></div>
            <div class="kpi-text"><span class="kpi-num">{{ totalParts() }}</span><span class="kpi-lbl">Parts</span></div>
          </div>
          <div class="kpi">
            <div class="kpi-icon tone-purple"><mat-icon>scale</mat-icon></div>
            <div class="kpi-text"><span class="kpi-num">{{ tonnes(totalKg()) }} <small>t</small></span><span class="kpi-lbl">Total tonnage</span></div>
          </div>
        </div>

        <!-- Toolbar: search -->
        <div class="toolbar">
          <div class="search-box">
            <mat-icon class="search-ico">search</mat-icon>
            <input type="text" placeholder="Search by name, job # or client…" [(ngModel)]="search" />
            @if (search) { <mat-icon class="clear" (click)="search = ''">close</mat-icon> }
          </div>
        </div>

        @if (filtered().length === 0) {
          <div class="empty-state slim"><mat-icon>filter_alt_off</mat-icon><p>No projects match your filters.</p></div>
        } @else {
          <div class="proj-list">
            @for (p of filtered(); track p.id) {
              <div class="proj-row" (click)="open(p)">
                <div class="row-main">
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

                  <div class="col-prog">
                    @if (p.metrics.nodeCount > 0) {
                      <span class="comp"><mat-icon>widgets</mat-icon>{{ p.metrics.assemblyCount }} assemblies <span class="dotsep">·</span> {{ p.metrics.partCount }} parts</span>
                    } @else {
                      <span class="no-tree"><mat-icon>upload_file</mat-icon>No model imported</span>
                    }
                  </div>

                  <mat-icon class="chevron">chevron_right</mat-icon>
                </div>

                <!-- Insight meta line: tonnage, age -->
                <div class="row-meta">
                  @if (p.metrics.tonnage.totalKg > 0) { <span class="m"><mat-icon>scale</mat-icon>{{ tonnes(p.metrics.tonnage.totalKg) }} t total</span> }
                  <span class="m muted"><mat-icon>schedule</mat-icon>Created {{ p.createdAt | date:'mediumDate' }}</span>
                </div>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .portfolio { max-width: 1280px; margin: 0 auto; }
    .center { display: flex; justify-content: center; padding: 64px 0; }
    .header-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .monitor-btn {
      display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
      background: var(--clay-surface); color: var(--clay-text-secondary);
      border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius-sm); padding: 9px 16px;
      font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all .15s;
    }
    .monitor-btn:hover { border-color: var(--clay-primary); color: var(--clay-primary); background: var(--info-bg); }
    .monitor-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .new-btn {
      display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
      background: var(--clay-primary); color: #fff; border: none;
      border-radius: var(--clay-radius-sm); padding: 10px 18px;
      font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all .15s;
    }
    .new-btn:hover { filter: brightness(1.08); transform: translateY(-1px); box-shadow: var(--clay-shadow-raised); }
    .new-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .empty-state .new-btn { margin: 16px auto 0; }
    .empty-state.slim { padding: 40px 20px; }
    .empty-state.slim mat-icon { font-size: 40px; width: 40px; height: 40px; }

    /* ── KPIs ──────────────────────────────────────────────── */
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 18px; }
    .kpi {
      display: flex; align-items: center; gap: 14px;
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius); padding: 16px 18px; box-shadow: var(--clay-shadow-soft);
    }
    .kpi.alert { border-color: var(--danger); }
    .kpi-icon {
      width: 44px; height: 44px; border-radius: var(--clay-radius-sm);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .kpi-icon mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .tone-blue { background: var(--kpi-blue-bg); color: var(--kpi-blue-fg); }
    .tone-purple { background: var(--kpi-purple-bg); color: var(--kpi-purple-fg); }
    .tone-green { background: var(--kpi-green-bg); color: var(--kpi-green-fg); }
    .tone-orange { background: var(--kpi-orange-bg); color: var(--kpi-orange-fg); }
    .tone-danger { background: var(--danger-bg); color: var(--danger); }
    .kpi-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .kpi-num { font-size: 24px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; line-height: 1.05; }
    .kpi-num small { font-size: 13px; font-weight: 500; color: var(--clay-text-muted); }
    .kpi-lbl { font-size: 12px; color: var(--clay-text-muted); }

    /* ── Toolbar ───────────────────────────────────────────── */
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
    .search-box {
      display: flex; align-items: center; gap: 8px; background: var(--clay-surface);
      border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm);
      padding: 8px 12px; width: 340px; max-width: 100%; transition: border-color .2s;
    }
    .search-box:focus-within { border-color: var(--clay-primary); }
    .search-box .search-ico { font-size: 18px; width: 18px; height: 18px; color: var(--clay-text-muted); }
    .search-box input { border: none; outline: none; background: transparent; font-size: 13px; color: var(--clay-text); width: 100%; font-family: inherit; }
    .search-box input::placeholder { color: var(--clay-text-muted); }
    .search-box .clear { font-size: 16px; width: 16px; height: 16px; color: var(--clay-text-muted); cursor: pointer; }

    /* ── Project rows ──────────────────────────────────────── */
    .proj-list {
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius); overflow: hidden; box-shadow: var(--clay-shadow-soft);
    }
    .proj-row {
      display: flex; flex-direction: column; gap: 10px; padding: 14px 18px;
      border-bottom: 1px solid var(--clay-border); cursor: pointer; transition: background .15s;
    }
    .proj-row:last-child { border-bottom: none; }
    .proj-row:hover { background: var(--clay-surface-hover); }
    .row-main {
      display: grid; grid-template-columns: minmax(220px, 1.6fr) minmax(120px, 1.1fr) 24px;
      align-items: center; gap: 18px;
    }
    .col-id { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .p-ico { font-size: 20px; width: 20px; height: 20px; color: var(--clay-primary); flex-shrink: 0; }
    .id-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .p-name { font-weight: 600; font-size: 14px; color: var(--clay-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .p-sub { font-size: 12px; color: var(--clay-text-muted); display: flex; align-items: center; gap: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .p-sub .mono { font-family: 'Space Grotesk', monospace; }
    .p-sub .muted { opacity: .7; }
    .dotsep { opacity: .5; }

    .col-prog { display: flex; align-items: center; gap: 10px; }
    .comp { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--clay-text-secondary); white-space: nowrap; }
    .comp mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--clay-text-muted); }
    .no-tree { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--clay-text-muted); }
    .no-tree mat-icon { font-size: 15px; width: 15px; height: 15px; }

    /* Insight meta line */
    .row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding-top: 10px; border-top: 1px solid var(--clay-border); }
    .m { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--clay-text-secondary); white-space: nowrap; }
    .m mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--clay-text-muted); }
    .m.muted { color: var(--clay-text-muted); }
    .m.program { font-weight: 600; color: var(--clay-text); }
    .m.program mat-icon { color: var(--clay-primary); }
    .m.program.warn { color: var(--warning-text); }
    .m.program.warn mat-icon { color: var(--warning); }

    .chevron { color: var(--clay-text-muted); font-size: 20px; width: 20px; height: 20px; }

    @media (max-width: 920px) {
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
      .row-main { grid-template-columns: 1fr auto; row-gap: 10px; }
      .col-prog { grid-column: 1 / -1; }
      .chevron { display: none; }
    }
  `],
})
export class ProjectListComponent implements OnInit {
  private svc = inject(ProjectsService);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  projects: ProjectSummary[] = [];
  loading = true;
  search = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.svc.summary().subscribe({
      next: (p) => { this.projects = p; this.loading = false; },
      // Degrade gracefully if the rollup endpoint is unavailable: still show the
      // list (sans metrics) rather than a blank page.
      error: () => {
        this.svc.list().subscribe({
          next: (list) => { this.projects = list.map((p) => ({ ...p, metrics: this.emptyMetrics() })); this.loading = false; },
          error: () => { this.loading = false; },
        });
      },
    });
  }

  private emptyMetrics(): ProjectSummary['metrics'] {
    return { nodeCount: 0, partCount: 0, assemblyCount: 0, tonnage: { totalKg: 0 } };
  }

  filtered(): ProjectSummary[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.projects;
    return this.projects.filter((p) =>
      [p.name, p.projectNumber, p.clientName].some((v) => (v ?? '').toLowerCase().includes(q)),
    );
  }

  totalAssemblies(): number { return this.projects.reduce((s, p) => s + (p.metrics.assemblyCount ?? 0), 0); }
  totalParts(): number { return this.projects.reduce((s, p) => s + (p.metrics.partCount ?? 0), 0); }
  totalKg(): number { return this.projects.reduce((s, p) => s + (p.metrics.tonnage.totalKg ?? 0), 0); }

  tonnes(kg: number): string {
    const t = (kg ?? 0) / 1000;
    return t >= 100 ? Math.round(t).toString() : (Math.round(t * 10) / 10).toString();
  }

  openWizard(): void {
    this.dialog.open(ProjectWizardComponent, { width: '640px', maxWidth: '95vw' })
      .afterClosed().subscribe((created: { id: string } | undefined) => {
        // The wizard owns navigation on success (Package Monitor when a file was
        // uploaded, the project list otherwise) — here we just refresh the list.
        if (created) this.load();
      });
  }

  open(p: ProjectSummary): void { this.router.navigate(['/projects', p.id]); }
}
