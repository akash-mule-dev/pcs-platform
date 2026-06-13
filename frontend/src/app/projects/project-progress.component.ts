import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ProjectsService, OrderProgress } from '../core/services/projects.service';

/** Progress tab of ONE work order: count-based overall % + the per-stage funnel.
 *  A project can back many orders, so progress is tracked per order, not per project. */
@Component({
  selector: 'app-project-progress',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    @if (p(); as prog) {
      @if (prog.unitsTotal === 0) {
        <div class="empty-state"><mat-icon>insights</mat-icon><h3>Nothing to report yet</h3><p>This work order has no stage quantities to track.</p></div>
      } @else {
        <div class="grid">
          <!-- Hero -->
          <div class="card hero">
            <svg viewBox="0 0 120 120" class="donut">
              <circle cx="60" cy="60" r="52" class="track"></circle>
              <circle cx="60" cy="60" r="52" class="val" [attr.stroke-dasharray]="CIRC" [attr.stroke-dashoffset]="offset()" transform="rotate(-90 60 60)"></circle>
              <text x="60" y="56" class="d-big">{{ prog.percentComplete }}%</text>
              <text x="60" y="76" class="d-small">complete</text>
            </svg>
            <div class="hero-meta">
              <div class="hm"><strong>{{ prog.assemblies }}</strong><span>assemblies</span></div>
              <div class="hm"><strong class="cap">{{ statusLabel(prog.status) }}</strong><span>status</span></div>
            </div>
          </div>

          <!-- Funnel -->
          <div class="card wide">
            <h3>Stage funnel</h3>
            @if (prog.stages.length) {
              <div class="funnel">
                @for (s of prog.stages; track s.stageId) {
                  <div class="srow">
                    <span class="sname">{{ s.name }}</span>
                    <div class="sbar">
                      <div class="bseg done" [style.width.%]="s.percent" [title]="s.done + ' of ' + s.total + ' done'"></div>
                    </div>
                    <span class="snum">{{ s.done }}/{{ s.total }}</span>
                  </div>
                }
              </div>
            } @else {
              <p class="muted">No stages on this work order.</p>
            }
          </div>
        </div>
      }
    } @else if (error()) {
      <div class="empty-state"><mat-icon>error_outline</mat-icon><p>{{ error() }}</p></div>
    } @else {
      <div class="empty-state"><mat-icon>insights</mat-icon><p>Loading progress…</p></div>
    }
  `,
  styles: [`
    .muted { color: var(--clay-text-muted); font-size: 13px; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
    .card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 18px 20px; box-shadow: var(--clay-shadow-soft); }
    .card h3 { margin: 0 0 14px; font-size: 14px; font-weight: 700; color: var(--clay-text); }
    .hero { display: flex; align-items: center; gap: 28px; flex-wrap: wrap; }
    .donut { width: 132px; height: 132px; flex-shrink: 0; }
    .donut .track { fill: none; stroke: var(--clay-bg-warm); stroke-width: 12; }
    .donut .val { fill: none; stroke: var(--clay-primary); stroke-width: 12; stroke-linecap: round; transition: stroke-dashoffset .6s ease; }
    .donut .d-big { fill: var(--clay-text); font-size: 24px; font-weight: 700; text-anchor: middle; font-family: 'Space Grotesk','Inter',sans-serif; }
    .donut .d-small { fill: var(--clay-text-muted); font-size: 9px; text-anchor: middle; text-transform: uppercase; letter-spacing: .08em; }
    .hero-meta { display: flex; gap: 32px; flex-wrap: wrap; }
    .hm { display: flex; flex-direction: column; }
    .hm strong { font-size: 1.6rem; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; } .hm span { color: var(--clay-text-muted); font-size: 12px; }
    .hm strong.cap { font-size: 1.1rem; text-transform: capitalize; padding-top: 8px; }
    .funnel { display: flex; flex-direction: column; gap: 10px; }
    .srow { display: grid; grid-template-columns: 150px 1fr 70px; align-items: center; gap: 12px; }
    .sname { font-weight: 500; font-size: 13px; color: var(--clay-text); }
    .sbar { display: flex; height: 16px; background: var(--clay-bg-warm); border-radius: 6px; overflow: hidden; }
    .bseg.done { background: var(--success); }
    .snum { text-align: right; color: var(--clay-text-muted); font-size: 12px; font-family: 'Space Grotesk','Inter',sans-serif; }
    @media (max-width: 820px) { .hero { flex-direction: column; align-items: flex-start; } .srow { grid-template-columns: 110px 1fr 56px; } }
  `],
})
export class ProjectProgressComponent implements OnInit {
  private svc = inject(ProjectsService);
  private route = inject(ActivatedRoute);
  readonly CIRC = 2 * Math.PI * 52;

  p = signal<OrderProgress | null>(null);
  error = signal<string | null>(null);
  offset = computed(() => this.CIRC * (1 - Math.min(100, Math.max(0, this.p()?.percentComplete ?? 0)) / 100));

  ngOnInit(): void {
    const orderId = this.route.parent?.snapshot.paramMap.get('orderId')
      ?? this.route.snapshot.paramMap.get('orderId') ?? '';
    if (!orderId) { this.error.set('Work order not found.'); return; }
    this.svc.orderProgress(orderId).subscribe({
      next: (g) => this.p.set(g),
      error: (e) => this.error.set(e?.error?.message || 'Could not load progress.'),
    });
  }

  statusLabel(s: string): string {
    return ({ not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' } as Record<string, string>)[s] ?? s;
  }
}
