import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { AssemblyNode, NodeQualityStatus } from '../core/services/projects.service';

interface QaRow { node: AssemblyNode; q: NodeQualityStatus; flagged: boolean; }

/** Quality tab: a project-wide QC overview — totals + every inspected item,
 *  flagged ones first, each linking back to the Assemblies tab focused on it. */
@Component({
  selector: 'app-project-quality',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    @if ((store.quality()?.totals?.inspected ?? 0) === 0 && openNcr() === 0) {
      <div class="empty-state">
        <mat-icon>verified</mat-icon>
        <h3>No inspections yet</h3>
        <p>Record quality checks from the Assemblies tab — select an item and mark it pass / warning / fail, take a measurement, or raise an NCR.</p>
        <a class="cta" (click)="goInspect()"><mat-icon>checklist</mat-icon>Go to Assemblies</a>
      </div>
    } @else {
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-icon tone-blue"><mat-icon>fact_check</mat-icon></div><div class="kt"><span class="kn">{{ store.quality()?.totals?.inspected ?? 0 }}</span><span class="kl">Items inspected</span></div></div>
        <div class="kpi" [class.alert]="(store.quality()?.totals?.failed ?? 0) > 0"><div class="kpi-icon" [class.tone-green]="(store.quality()?.totals?.failed ?? 0) === 0" [class.tone-danger]="(store.quality()?.totals?.failed ?? 0) > 0"><mat-icon>cancel</mat-icon></div><div class="kt"><span class="kn">{{ store.quality()?.totals?.failed ?? 0 }}</span><span class="kl">Failed checks</span></div></div>
        <div class="kpi" [class.alert]="openNcr() > 0"><div class="kpi-icon" [class.tone-orange]="openNcr() === 0" [class.tone-danger]="openNcr() > 0"><mat-icon>report_problem</mat-icon></div><div class="kt"><span class="kn">{{ openNcr() }}</span><span class="kl">Open NCRs</span></div></div>
      </div>

      @if (flagged().length > 0) {
        <h3 class="section"><mat-icon>priority_high</mat-icon>Needs attention <span class="badge bad">{{ flagged().length }}</span></h3>
        <div class="qa-table">
          @for (r of flagged(); track r.node.id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: r }"></ng-container> }
        </div>
      }

      @if (cleared().length > 0) {
        <h3 class="section ok"><mat-icon>check_circle</mat-icon>Cleared <span class="badge">{{ cleared().length }}</span></h3>
        <div class="qa-table">
          @for (r of cleared(); track r.node.id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: r }"></ng-container> }
        </div>
      }
    }

    <ng-template #row let-r>
      <div class="qrow" [class.flagged]="r.flagged" (click)="inspect(r.node)">
        <span class="q-dot qb-{{ r.q.status || (r.q.openNcr > 0 ? 'fail' : 'pass') }}"></span>
        <div class="q-id">
          <span class="q-name">{{ r.node.mark || r.node.name }}</span>
          <span class="q-sub">{{ typeLabel(r.node.nodeType) }}@if (r.node.profile) { · {{ r.node.profile }} }</span>
        </div>
        <div class="q-tally">
          @if (r.q.pass > 0) { <span class="t pass"><mat-icon>check</mat-icon>{{ r.q.pass }}</span> }
          @if (r.q.warning > 0) { <span class="t warn"><mat-icon>warning</mat-icon>{{ r.q.warning }}</span> }
          @if (r.q.fail > 0) { <span class="t fail"><mat-icon>close</mat-icon>{{ r.q.fail }}</span> }
          @if (r.q.openNcr > 0) { <span class="ncr-chip">{{ r.q.openNcr }} NCR</span> }
        </div>
        <span class="q-when">@if (r.q.lastInspectedAt) { {{ r.q.lastInspectedAt | date:'MMM d' }} }</span>
        <span class="q-cta">Inspect<mat-icon>chevron_right</mat-icon></span>
      </div>
    </ng-template>
  `,
  styles: [`
    .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 22px; }
    .kpi { display: flex; align-items: center; gap: 14px; background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); padding: 16px 18px; box-shadow: var(--clay-shadow-soft); }
    .kpi.alert { border-color: var(--danger); }
    .kpi-icon { width: 44px; height: 44px; border-radius: var(--clay-radius-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .kpi-icon mat-icon { font-size: 23px; width: 23px; height: 23px; }
    .tone-blue { background: var(--kpi-blue-bg); color: var(--kpi-blue-fg); }
    .tone-green { background: var(--kpi-green-bg); color: var(--kpi-green-fg); }
    .tone-orange { background: var(--kpi-orange-bg); color: var(--kpi-orange-fg); }
    .tone-danger { background: var(--danger-bg); color: var(--danger); }
    .kt { display: flex; flex-direction: column; gap: 2px; }
    .kn { font-size: 24px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; line-height: 1.05; }
    .kl { font-size: 12px; color: var(--clay-text-muted); }

    .section { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; color: var(--clay-text); margin: 0 0 10px; text-transform: uppercase; letter-spacing: .04em; }
    .section mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--danger); }
    .section.ok { margin-top: 22px; } .section.ok mat-icon { color: var(--success); }
    .badge { background: var(--clay-bg-warm); color: var(--clay-text-secondary); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 700; }
    .badge.bad { background: var(--danger-bg); color: var(--danger-text); }

    .qa-table { background: var(--clay-surface); border: 1px solid var(--clay-border); border-radius: var(--clay-radius); overflow: hidden; box-shadow: var(--clay-shadow-soft); }
    .qrow { display: grid; grid-template-columns: 14px minmax(180px, 1.6fr) auto 70px 90px; align-items: center; gap: 14px; padding: 12px 16px; border-bottom: 1px solid var(--clay-border); cursor: pointer; transition: background .15s; }
    .qrow:last-child { border-bottom: none; }
    .qrow:hover { background: var(--clay-surface-hover); }
    .qrow.flagged { background: color-mix(in srgb, var(--danger-bg) 35%, transparent); }
    .qrow.flagged:hover { background: var(--danger-bg); }
    .q-dot { width: 11px; height: 11px; border-radius: 50%; }
    .qb-pass { background: var(--success); } .qb-warning { background: var(--warning); } .qb-fail { background: var(--danger); }
    .q-id { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .q-name { font-weight: 600; font-size: 13px; color: var(--clay-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .q-sub { font-size: 11px; color: var(--clay-text-muted); text-transform: capitalize; }
    .q-tally { display: flex; align-items: center; gap: 8px; }
    .t { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; font-weight: 700; }
    .t mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .t.pass { color: var(--success-text); } .t.warn { color: var(--warning-text); } .t.fail { color: var(--danger-text); }
    .ncr-chip { background: var(--danger-bg); color: var(--danger-text); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 700; }
    .q-when { font-size: 12px; color: var(--clay-text-muted); text-align: right; }
    .q-cta { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; font-weight: 600; color: var(--clay-primary); justify-content: flex-end; }
    .q-cta mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .cta { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; background: var(--clay-primary); color: #fff; padding: 10px 18px; border-radius: var(--clay-radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; }
    .cta mat-icon { font-size: 18px; width: 18px; height: 18px; }
    @media (max-width: 720px) { .kpi-grid { grid-template-columns: 1fr; } .qrow { grid-template-columns: 14px 1fr auto; } .q-when, .q-cta { display: none; } }
  `],
})
export class ProjectQualityComponent {
  store = inject(ProjectWorkspaceStore);
  private router = inject(Router);

  openNcr = this.store.openNcr;

  private rows = computed<QaRow[]>(() => {
    const q = this.store.quality();
    if (!q) return [];
    const out: QaRow[] = [];
    for (const n of this.store.nodes()) {
      const e = q.nodes[n.id];
      if (!e || (e.total === 0 && e.openNcr === 0)) continue;
      const flagged = e.status === 'fail' || e.status === 'warning' || e.openNcr > 0;
      out.push({ node: n, q: e, flagged });
    }
    return out.sort((a, b) => (b.q.lastInspectedAt ?? '').localeCompare(a.q.lastInspectedAt ?? ''));
  });

  flagged = computed(() => this.rows().filter((r) => r.flagged));
  cleared = computed(() => this.rows().filter((r) => !r.flagged));

  typeLabel(t: string): string {
    return { group: 'Group', assembly: 'Assembly', subassembly: 'Sub-assembly', part: 'Part' }[t] ?? t;
  }

  inspect(node: AssemblyNode): void {
    this.router.navigate(['/projects', this.store.id(), 'assemblies'], { queryParams: { focus: node.id } });
  }
  goInspect(): void {
    this.router.navigate(['/projects', this.store.id(), 'assemblies']);
  }
}
