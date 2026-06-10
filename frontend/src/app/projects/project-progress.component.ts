import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ProjectWorkspaceStore } from './project-workspace.store';

interface StatusSeg { key: string; label: string; color: string; count: number; }

/** Progress tab: overall %, status breakdown, tonnage and the per-stage funnel.
 *  Reads the shared workspace store (the shell header already shows identity). */
@Component({
  selector: 'app-project-progress',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    @if (p(); as prog) {
      @if (prog.nodes.total === 0) {
        <div class="empty-state"><mat-icon>insights</mat-icon><h3>Nothing to report yet</h3><p>Import an IFC and generate work orders to populate progress.</p></div>
      } @else {
        <div class="grid">
          <!-- Hero -->
          <div class="card hero">
            <svg viewBox="0 0 120 120" class="donut">
              <circle cx="60" cy="60" r="52" class="track"></circle>
              <circle cx="60" cy="60" r="52" class="val" [attr.stroke-dasharray]="CIRC" [attr.stroke-dashoffset]="offset()" transform="rotate(-90 60 60)"></circle>
              <text x="60" y="56" class="d-big">{{ prog.percentComplete }}%</text>
              <text x="60" y="76" class="d-small">processed</text>
            </svg>
            <div class="hero-meta">
              <div class="hm"><strong>{{ prog.nodes.assembly + prog.nodes.subassembly }}</strong><span>assemblies</span></div>
              <div class="hm"><strong>{{ prog.tonnage.totalKg | number:'1.0-0' }}</strong><span>kg total</span></div>
              <div class="hm"><strong>{{ prog.workOrders }}</strong><span>work orders</span></div>
              <div class="hm"><strong>{{ prog.nodes.part }}</strong><span>parts</span></div>
            </div>
          </div>

          <!-- Status -->
          <div class="card">
            <h3>Assemblies by status</h3>
            @if (fabTotal() > 0) {
              <div class="stack">
                @for (s of statusSegs(); track s.key) { @if (s.count > 0) { <div class="seg" [style.flex]="s.count" [style.background]="s.color" [title]="s.label + ': ' + s.count"></div> } }
              </div>
              <div class="legend">
                @for (s of statusSegs(); track s.key) { @if (s.count > 0) { <span class="lg"><span class="dot" [style.background]="s.color"></span>{{ s.label }} <strong>{{ s.count }}</strong></span> } }
              </div>
            } @else {
              <p class="muted">No work orders generated yet — route assemblies through a process to start tracking.</p>
            }
          </div>

          <!-- Tonnage -->
          <div class="card">
            <h3>Tonnage</h3>
            <div class="tons">
              <div class="ton">
                <span class="tl">Processed</span><span class="tv">{{ prog.tonnage.processedKg | number:'1.0-0' }} <em>/ {{ prog.tonnage.totalKg | number:'1.0-0' }} kg</em></span>
                <div class="tbar"><div class="tfill proc" [style.width.%]="pct(prog.tonnage.processedKg, prog.tonnage.totalKg)"></div></div>
              </div>
              <div class="ton">
                <span class="tl">Shipped</span><span class="tv">{{ prog.tonnage.shippedKg | number:'1.0-0' }} <em>/ {{ prog.tonnage.totalKg | number:'1.0-0' }} kg</em></span>
                <div class="tbar"><div class="tfill ship" [style.width.%]="pct(prog.tonnage.shippedKg, prog.tonnage.totalKg)"></div></div>
              </div>
            </div>
          </div>

          <!-- Funnel -->
          <div class="card wide">
            <h3>Stage funnel</h3>
            @if (prog.stages.length) {
              <div class="funnel">
                @for (s of prog.stages; track s.name) {
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
                <span class="lg"><span class="dot done"></span>Done</span>
                <span class="lg"><span class="dot prog"></span>In progress</span>
                <span class="lg"><span class="dot pend"></span>Pending</span>
              </div>
            } @else {
              <p class="muted">No stages yet. Generate work orders against a process to populate the funnel.</p>
            }
          </div>
        </div>
      }
    } @else {
      <div class="empty-state"><mat-icon>insights</mat-icon><p>Loading progress…</p></div>
    }
  `,
  styles: [`
    .muted { color: var(--clay-text-muted); font-size: 13px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 18px 20px; box-shadow: var(--clay-shadow-soft); }
    .card.wide { grid-column: 1 / -1; }
    .card h3 { margin: 0 0 14px; font-size: 14px; font-weight: 700; color: var(--clay-text); }
    .hero { grid-column: 1 / -1; display: flex; align-items: center; gap: 28px; flex-wrap: wrap; }
    .donut { width: 132px; height: 132px; flex-shrink: 0; }
    .donut .track { fill: none; stroke: var(--clay-bg-warm); stroke-width: 12; }
    .donut .val { fill: none; stroke: var(--clay-primary); stroke-width: 12; stroke-linecap: round; transition: stroke-dashoffset .6s ease; }
    .donut .d-big { fill: var(--clay-text); font-size: 24px; font-weight: 700; text-anchor: middle; font-family: 'Space Grotesk','Inter',sans-serif; }
    .donut .d-small { fill: var(--clay-text-muted); font-size: 9px; text-anchor: middle; text-transform: uppercase; letter-spacing: .08em; }
    .hero-meta { display: flex; gap: 32px; flex-wrap: wrap; }
    .hm { display: flex; flex-direction: column; }
    .hm strong { font-size: 1.6rem; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; } .hm span { color: var(--clay-text-muted); font-size: 12px; }
    .stack { display: flex; height: 22px; border-radius: 6px; overflow: hidden; background: var(--clay-bg-warm); gap: 2px; }
    .stack .seg { height: 100%; min-width: 5px; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 12px; }
    .lg { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--clay-text-secondary); }
    .dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .dot.done { background: var(--success); } .dot.prog { background: var(--warning); } .dot.pend { background: var(--clay-bg-warm); border: 1px solid var(--clay-border); }
    .lg strong { color: var(--clay-text); }
    .tons { display: flex; flex-direction: column; gap: 16px; }
    .ton { display: grid; grid-template-columns: 90px 1fr; align-items: center; gap: 6px 10px; }
    .tl { color: var(--clay-text-secondary); font-size: 13px; } .tv { font-weight: 600; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; } .tv em { color: var(--clay-text-muted); font-weight: 400; font-style: normal; }
    .tbar { grid-column: 1 / -1; height: 8px; background: var(--clay-bg-warm); border-radius: 5px; overflow: hidden; }
    .tfill { height: 100%; border-radius: 5px; transition: width .5s ease; } .tfill.proc { background: var(--clay-primary); } .tfill.ship { background: var(--clay-primary-light); }
    .funnel { display: flex; flex-direction: column; gap: 10px; }
    .srow { display: grid; grid-template-columns: 150px 1fr 56px; align-items: center; gap: 12px; }
    .sname { font-weight: 500; font-size: 13px; color: var(--clay-text); }
    .sbar { display: flex; height: 16px; background: var(--clay-bg-warm); border-radius: 6px; overflow: hidden; }
    .bseg.done { background: var(--success); } .bseg.prog { background: var(--warning); }
    .snum { text-align: right; color: var(--clay-text-muted); font-size: 12px; font-family: 'Space Grotesk','Inter',sans-serif; }
    @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } .hero { flex-direction: column; align-items: flex-start; } .srow { grid-template-columns: 110px 1fr 48px; } }
  `],
})
export class ProjectProgressComponent {
  store = inject(ProjectWorkspaceStore);
  readonly CIRC = 2 * Math.PI * 52;

  p = this.store.progress;
  offset = computed(() => this.CIRC * (1 - Math.min(100, Math.max(0, this.p()?.percentComplete ?? 0)) / 100));

  pct(n: number, total: number): number { return total > 0 ? Math.min(100, (n / total) * 100) : 0; }

  statusSegs(): StatusSeg[] {
    const s = this.p()?.status ?? ({} as Record<string, number>);
    return [
      { key: 'not_started', label: 'Not started', color: 'var(--clay-text-muted)', count: s['not_started'] ?? 0 },
      { key: 'in_progress', label: 'In progress', color: 'var(--warning)', count: s['in_progress'] ?? 0 },
      { key: 'ready_to_ship', label: 'Ready to ship', color: 'var(--success)', count: s['ready_to_ship'] ?? 0 },
      { key: 'shipped', label: 'Shipped', color: 'var(--clay-primary-light)', count: s['shipped'] ?? 0 },
      { key: 'on_hold', label: 'On hold', color: 'var(--danger)', count: s['on_hold'] ?? 0 },
    ];
  }
  fabTotal(): number { return this.statusSegs().reduce((a, s) => a + s.count, 0); }
}
