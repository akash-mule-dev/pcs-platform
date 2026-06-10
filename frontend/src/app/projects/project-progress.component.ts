import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProjectsService, Project, ProjectProgress } from '../core/services/projects.service';

interface StatusSeg { key: string; label: string; color: string; count: number; }

@Component({
  selector: 'app-project-progress',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      <a class="back" [routerLink]="['/projects', id]"><mat-icon>arrow_back</mat-icon>&nbsp;Back to project</a>
      <div class="head">
        <h1><mat-icon>insights</mat-icon>&nbsp;Progress{{ project ? ' — ' + project.name : '' }}</h1>
        <button mat-icon-button (click)="load()" [disabled]="loading" title="Refresh"><mat-icon>sync</mat-icon></button>
      </div>

      @if (loading) {
        <div class="center"><mat-spinner diameter="36"></mat-spinner></div>
      } @else if (p) {
        <div class="grid">
          <!-- Hero ring -->
          <div class="card hero">
            <svg viewBox="0 0 120 120" class="donut" role="img" aria-label="Overall progress">
              <circle cx="60" cy="60" r="52" class="track"></circle>
              <circle cx="60" cy="60" r="52" class="val" [attr.stroke-dasharray]="CIRC"
                      [attr.stroke-dashoffset]="offset" transform="rotate(-90 60 60)"></circle>
              <text x="60" y="56" class="d-big">{{ p.percentComplete }}%</text>
              <text x="60" y="76" class="d-small">processed</text>
            </svg>
            <div class="hero-meta">
              <div class="hm"><strong>{{ p.nodes.assembly + p.nodes.subassembly }}</strong><span>assemblies</span></div>
              <div class="hm"><strong>{{ p.tonnage.totalKg | number:'1.0-0' }}</strong><span>kg total</span></div>
              <div class="hm"><strong>{{ p.workOrders }}</strong><span>work orders</span></div>
            </div>
          </div>

          <!-- Status breakdown -->
          <div class="card">
            <h3>Assemblies by status</h3>
            @if (fabTotal() > 0) {
              <div class="stack">
                @for (s of statusSegs(); track s.key) {
                  @if (s.count > 0) {
                    <div class="seg" [style.width.%]="s.count / fabTotal() * 100" [style.background]="s.color" [title]="s.label + ': ' + s.count"></div>
                  }
                }
              </div>
              <div class="legend">
                @for (s of statusSegs(); track s.key) {
                  <span class="lg"><span class="dot" [style.background]="s.color"></span>{{ s.label }} <strong>{{ s.count }}</strong></span>
                }
              </div>
            } @else {
              <p class="muted">No work orders generated yet — route assemblies through a process to start tracking.</p>
            }
          </div>

          <!-- Tonnage -->
          <div class="card">
            <h3>Tonnage</h3>
            <div class="tons">
              <div class="ton"><span class="tl">Processed</span><span class="tv">{{ p.tonnage.processedKg | number:'1.0-0' }} <em>/ {{ p.tonnage.totalKg | number:'1.0-0' }} kg</em></span>
                <div class="tbar"><div class="tfill proc" [style.width.%]="pct(p.tonnage.processedKg, p.tonnage.totalKg)"></div></div>
              </div>
              <div class="ton"><span class="tl">Shipped</span><span class="tv">{{ p.tonnage.shippedKg | number:'1.0-0' }} <em>/ {{ p.tonnage.totalKg | number:'1.0-0' }} kg</em></span>
                <div class="tbar"><div class="tfill ship" [style.width.%]="pct(p.tonnage.shippedKg, p.tonnage.totalKg)"></div></div>
              </div>
            </div>
          </div>

          <!-- Stage funnel -->
          <div class="card wide">
            <h3>Stage funnel</h3>
            @if (p.stages.length) {
              <div class="funnel">
                @for (s of p.stages; track s.name) {
                  <div class="srow">
                    <span class="sname">{{ s.name }}</span>
                    <div class="sbar">
                      <div class="bseg done" [style.width.%]="pct(s.done, s.total)" [title]="s.done + ' done'"></div>
                      <div class="bseg prog" [style.width.%]="pct(s.inProgress, s.total)" [title]="s.inProgress + ' in progress'"></div>
                    </div>
                    <span class="snum">{{ s.done }}/{{ s.total }}</span>
                  </div>
                }
              </div>
              <div class="legend">
                <span class="lg"><span class="dot" style="background:#10b981"></span>Done</span>
                <span class="lg"><span class="dot" style="background:#f59e0b"></span>In progress</span>
                <span class="lg"><span class="dot" style="background:#e5e7eb"></span>Pending</span>
              </div>
            } @else {
              <p class="muted">No stages yet. Generate work orders against a process to populate the funnel.</p>
            }
          </div>
        </div>
      } @else {
        <div class="center"><p>Project not found.</p></div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px; max-width: 1100px; margin: 0 auto; }
    .back { display: inline-flex; align-items: center; color: #6b7280; text-decoration: none; font-size: .9rem; margin-bottom: 12px; }
    .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .head h1 { display: flex; align-items: center; margin: 0; font-size: 1.5rem; }
    .center { display: flex; justify-content: center; padding: 48px 0; color: #6b7280; }
    .muted { color: #6b7280; font-size: .88rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { background: var(--mat-sys-surface, #fff); border: 1px solid rgba(0,0,0,.08); border-radius: 14px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    .card.wide { grid-column: 1 / -1; }
    .card h3 { margin: 0 0 14px; font-size: 1rem; }
    .hero { grid-column: 1 / -1; display: flex; align-items: center; gap: 28px; }
    .donut { width: 132px; height: 132px; flex-shrink: 0; }
    .donut .track { fill: none; stroke: #eceff3; stroke-width: 12; }
    .donut .val { fill: none; stroke: #2563eb; stroke-width: 12; stroke-linecap: round; transition: stroke-dashoffset .6s ease; }
    .donut .d-big { fill: #111827; font-size: 24px; font-weight: 700; text-anchor: middle; }
    .donut .d-small { fill: #6b7280; font-size: 9px; text-anchor: middle; text-transform: uppercase; letter-spacing: .08em; }
    .hero-meta { display: flex; gap: 32px; }
    .hm { display: flex; flex-direction: column; }
    .hm strong { font-size: 1.6rem; color: #111827; } .hm span { color: #6b7280; font-size: .82rem; }
    .stack { display: flex; height: 22px; border-radius: 6px; overflow: hidden; background: #f3f4f6; }
    .stack .seg { height: 100%; }
    .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 12px; }
    .lg { display: inline-flex; align-items: center; gap: 6px; font-size: .82rem; color: #4b5563; }
    .dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .tons { display: flex; flex-direction: column; gap: 16px; }
    .ton { display: grid; grid-template-columns: 90px 1fr; align-items: center; gap: 8px 10px; }
    .tl { color: #6b7280; font-size: .85rem; } .tv { font-weight: 600; } .tv em { color: #9ca3af; font-weight: 400; font-style: normal; }
    .tbar { grid-column: 1 / -1; height: 8px; background: #f3f4f6; border-radius: 5px; overflow: hidden; }
    .tfill { height: 100%; border-radius: 5px; } .tfill.proc { background: #2563eb; } .tfill.ship { background: #3b82f6; }
    .funnel { display: flex; flex-direction: column; gap: 10px; }
    .srow { display: grid; grid-template-columns: 140px 1fr 56px; align-items: center; gap: 12px; }
    .sname { font-weight: 500; font-size: .9rem; }
    .sbar { display: flex; height: 16px; background: #e5e7eb; border-radius: 6px; overflow: hidden; }
    .bseg.done { background: #10b981; } .bseg.prog { background: #f59e0b; }
    .snum { text-align: right; color: #6b7280; font-size: .82rem; }
    @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } .hero { flex-direction: column; align-items: flex-start; } }
  `],
})
export class ProjectProgressComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private svc = inject(ProjectsService);

  readonly CIRC = 2 * Math.PI * 52;
  id = '';
  project: Project | null = null;
  p: ProjectProgress | null = null;
  loading = true;
  offset = this.CIRC;

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.svc.get(this.id).subscribe({ next: (pr) => (this.project = pr), error: () => {} });
    this.load();
  }

  load(): void {
    this.loading = true;
    this.svc.getProgress(this.id).subscribe({
      next: (p) => {
        this.p = p;
        this.offset = this.CIRC * (1 - Math.min(100, Math.max(0, p.percentComplete)) / 100);
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  pct(n: number, total: number): number {
    return total > 0 ? Math.min(100, (n / total) * 100) : 0;
  }

  statusSegs(): StatusSeg[] {
    const s = this.p?.status ?? {};
    return [
      { key: 'not_started', label: 'Not started', color: '#9ca3af', count: s['not_started'] ?? 0 },
      { key: 'in_progress', label: 'In progress', color: '#f59e0b', count: s['in_progress'] ?? 0 },
      { key: 'ready_to_ship', label: 'Ready to ship', color: '#10b981', count: s['ready_to_ship'] ?? 0 },
      { key: 'shipped', label: 'Shipped', color: '#3b82f6', count: s['shipped'] ?? 0 },
      { key: 'on_hold', label: 'On hold', color: '#ef4444', count: s['on_hold'] ?? 0 },
    ];
  }

  fabTotal(): number {
    return this.statusSegs().reduce((a, s) => a + s.count, 0);
  }
}
