import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { ThreeViewerComponent } from '../shared/components/three-viewer/three-viewer.component';

interface NextStep { icon: string; tone: string; title: string; detail: string; cta: string; tab: string; }

/** Overview tab: a per-project dashboard — production health, tonnage, composition,
 *  contextual next steps and a 3D preview, all from the shared workspace store. */
@Component({
  selector: 'app-project-overview',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, ThreeViewerComponent],
  template: `
    @if (store.hasNodes()) {
      <div class="ov-grid">
        <!-- Production health -->
        <section class="card health">
          <div class="ring-wrap">
            <svg viewBox="0 0 120 120" class="donut">
              <circle cx="60" cy="60" r="52" class="track"></circle>
              <circle cx="60" cy="60" r="52" class="val" [attr.stroke-dasharray]="CIRC" [attr.stroke-dashoffset]="offset()" transform="rotate(-90 60 60)"></circle>
              <text x="60" y="56" class="d-big">{{ pct() }}%</text>
              <text x="60" y="75" class="d-small">processed</text>
            </svg>
          </div>
          <div class="health-meta">
            <h3>Production health</h3>
            <div class="status-stack">
              @for (s of statusSegs(); track s.key) {
                @if (s.count > 0) { <div class="seg" [style.flex]="s.count" [style.background]="s.color" [title]="s.label + ': ' + s.count"></div> }
              }
              @if (fabTotal() === 0) { <div class="seg empty"></div> }
            </div>
            <div class="legend">
              @for (s of statusSegs(); track s.key) {
                @if (s.count > 0) { <span class="lg"><span class="dot" [style.background]="s.color"></span>{{ s.label }} <strong>{{ s.count }}</strong></span> }
              }
            </div>
          </div>
        </section>

        <!-- Next steps -->
        <section class="card steps">
          <h3>Next steps</h3>
          @if (nextSteps().length === 0) {
            <div class="all-clear"><mat-icon>task_alt</mat-icon><p>You're on track — nothing needs attention right now.</p></div>
          } @else {
            @for (s of nextSteps(); track s.title) {
              <a class="step tone-{{ s.tone }}" [routerLink]="['/projects', store.id(), s.tab]">
                <div class="step-ico"><mat-icon>{{ s.icon }}</mat-icon></div>
                <div class="step-text"><span class="step-title">{{ s.title }}</span><span class="step-detail">{{ s.detail }}</span></div>
                <span class="step-cta">{{ s.cta }}<mat-icon>chevron_right</mat-icon></span>
              </a>
            }
          }
        </section>

        <!-- Tonnage -->
        <section class="card">
          <h3>Tonnage</h3>
          <div class="ton-row">
            <span class="tl">Processed</span>
            <span class="tv">{{ kg(prog()?.tonnage?.processedKg) }} <em>/ {{ kg(prog()?.tonnage?.totalKg) }} kg</em></span>
          </div>
          <div class="tbar"><div class="tfill proc" [style.width.%]="ratio(prog()?.tonnage?.processedKg, prog()?.tonnage?.totalKg)"></div></div>
          <div class="ton-row second">
            <span class="tl">Shipped</span>
            <span class="tv">{{ kg(prog()?.tonnage?.shippedKg) }} <em>/ {{ kg(prog()?.tonnage?.totalKg) }} kg</em></span>
          </div>
          <div class="tbar"><div class="tfill ship" [style.width.%]="ratio(prog()?.tonnage?.shippedKg, prog()?.tonnage?.totalKg)"></div></div>
        </section>

        <!-- Composition -->
        <section class="card">
          <h3>Composition</h3>
          <div class="comp">
            <div class="comp-cell"><span class="c-num">{{ prog()?.nodes?.assembly ?? 0 }}</span><span class="c-lbl">Assemblies</span></div>
            <div class="comp-cell"><span class="c-num">{{ prog()?.nodes?.subassembly ?? 0 }}</span><span class="c-lbl">Sub-assemblies</span></div>
            <div class="comp-cell"><span class="c-num">{{ prog()?.nodes?.part ?? 0 }}</span><span class="c-lbl">Parts</span></div>
            <div class="comp-cell"><span class="c-num">{{ prog()?.workOrders ?? 0 }}</span><span class="c-lbl">Work orders</span></div>
          </div>
        </section>

        <!-- 3D preview -->
        @if (store.fullModelUrl(); as url) {
          <section class="card preview">
            <div class="card-head"><h3>3D model</h3><a class="head-link" [routerLink]="['/projects', store.id(), 'assemblies']">Open viewer<mat-icon>open_in_full</mat-icon></a></div>
            <div class="viewer-box"><app-three-viewer [modelUrl]="url"></app-three-viewer></div>
          </section>
        } @else if (store.modelPending()) {
          <section class="card preview"><h3>3D model</h3><div class="pending"><mat-icon>hourglass_top</mat-icon><p>Converting in the background — it'll appear here shortly.</p></div></section>
        }

        <!-- Details -->
        <section class="card details">
          <h3>Details</h3>
          <dl>
            <div><dt>Client</dt><dd>{{ project()?.clientName || '—' }}</dd></div>
            <div><dt>Job number</dt><dd class="mono">{{ project()?.projectNumber || '—' }}</dd></div>
            <div><dt>Process</dt><dd>{{ processName() }}</dd></div>
            <div><dt>Due date</dt><dd [class.overdue]="store.isOverdue()">{{ project()?.dueDate ? (project()!.dueDate | date:'mediumDate') : '—' }}</dd></div>
            <div><dt>Created</dt><dd>{{ project()?.createdAt | date:'mediumDate' }}</dd></div>
          </dl>
          @if (project()?.description) { <p class="desc">{{ project()?.description }}</p> }
        </section>
      </div>
    } @else {
      <div class="empty-state">
        <mat-icon>account_tree</mat-icon>
        <h3>No assemblies yet</h3>
        <p>Import an IFC file to build this project's assembly tree, 3D model and production tracking.</p>
        <a class="cta" [routerLink]="['/projects', store.id(), 'assemblies']"><mat-icon>upload_file</mat-icon>Go to Assemblies to import</a>
      </div>
    }
  `,
  styles: [`
    .ov-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; align-items: start; }
    .card {
      background: var(--clay-surface); border: 1px solid var(--clay-border);
      border-radius: var(--clay-radius); padding: 18px 20px; box-shadow: var(--clay-shadow-soft);
    }
    .card h3 { margin: 0 0 14px; font-size: 14px; font-weight: 700; color: var(--clay-text); }
    .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .card-head h3 { margin: 0; }
    .head-link { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; font-weight: 600; color: var(--clay-primary); }
    .head-link mat-icon { font-size: 15px; width: 15px; height: 15px; }

    /* Health */
    .health { display: flex; gap: 22px; align-items: center; }
    .ring-wrap { flex-shrink: 0; }
    .donut { width: 120px; height: 120px; }
    .donut .track { fill: none; stroke: var(--clay-bg-warm); stroke-width: 11; }
    .donut .val { fill: none; stroke: var(--clay-primary); stroke-width: 11; stroke-linecap: round; transition: stroke-dashoffset .6s ease; }
    .donut .d-big { fill: var(--clay-text); font-size: 23px; font-weight: 700; text-anchor: middle; font-family: 'Space Grotesk','Inter',sans-serif; }
    .donut .d-small { fill: var(--clay-text-muted); font-size: 9px; text-anchor: middle; text-transform: uppercase; letter-spacing: .08em; }
    .health-meta { flex: 1; min-width: 0; }
    .health-meta h3 { margin-bottom: 10px; }
    .status-stack { display: flex; height: 18px; border-radius: 6px; overflow: hidden; background: var(--clay-bg-warm); gap: 2px; }
    .status-stack .seg { height: 100%; min-width: 4px; } .status-stack .seg.empty { flex: 1; background: var(--clay-bg-warm); }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 12px; }
    .lg { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--clay-text-secondary); }
    .lg .dot { width: 9px; height: 9px; border-radius: 3px; }
    .lg strong { color: var(--clay-text); }

    /* Next steps */
    .steps { display: flex; flex-direction: column; }
    .steps h3 { margin-bottom: 12px; }
    .step {
      display: flex; align-items: center; gap: 12px; padding: 11px 12px;
      border: 1px solid var(--clay-border); border-radius: var(--clay-radius-sm);
      margin-bottom: 8px; transition: all .15s;
    }
    .step:last-child { margin-bottom: 0; }
    .step:hover { border-color: var(--clay-primary); background: var(--clay-surface-hover); transform: translateX(2px); }
    .step-ico { width: 36px; height: 36px; border-radius: var(--clay-radius-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .step-ico mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .tone-blue .step-ico { background: var(--kpi-blue-bg); color: var(--kpi-blue-fg); }
    .tone-green .step-ico { background: var(--kpi-green-bg); color: var(--kpi-green-fg); }
    .tone-orange .step-ico { background: var(--kpi-orange-bg); color: var(--kpi-orange-fg); }
    .tone-danger .step-ico { background: var(--danger-bg); color: var(--danger); }
    .step-text { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
    .step-title { font-size: 13px; font-weight: 600; color: var(--clay-text); }
    .step-detail { font-size: 12px; color: var(--clay-text-muted); }
    .step-cta { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; font-weight: 600; color: var(--clay-primary); white-space: nowrap; }
    .step-cta mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .all-clear { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px; color: var(--clay-text-muted); text-align: center; }
    .all-clear mat-icon { font-size: 34px; width: 34px; height: 34px; color: var(--success); }
    .all-clear p { margin: 0; font-size: 13px; }

    /* Tonnage */
    .ton-row { display: flex; justify-content: space-between; align-items: baseline; }
    .ton-row.second { margin-top: 14px; }
    .tl { font-size: 13px; color: var(--clay-text-secondary); }
    .tv { font-size: 13px; font-weight: 600; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; }
    .tv em { font-style: normal; color: var(--clay-text-muted); font-weight: 400; }
    .tbar { height: 8px; background: var(--clay-bg-warm); border-radius: 5px; overflow: hidden; margin-top: 6px; }
    .tfill { height: 100%; border-radius: 5px; transition: width .5s ease; }
    .tfill.proc { background: var(--clay-primary); } .tfill.ship { background: var(--clay-primary-light); }

    /* Composition */
    .comp { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .comp-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 12px 6px; background: var(--clay-bg-warm); border-radius: var(--clay-radius-sm); }
    .c-num { font-size: 22px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; }
    .c-lbl { font-size: 11px; color: var(--clay-text-muted); text-align: center; }

    /* Preview */
    .preview { grid-column: 1 / -1; }
    .viewer-box { height: 320px; border-radius: var(--clay-radius-sm); overflow: hidden; }
    .viewer-box app-three-viewer { display: block; height: 100%; }
    .pending { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px; color: var(--clay-text-muted); }
    .pending mat-icon { font-size: 32px; width: 32px; height: 32px; }

    /* Details */
    .details { grid-column: 1 / -1; }
    .details dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin: 0; }
    .details dt { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--clay-text-muted); margin-bottom: 3px; }
    .details dd { margin: 0; font-size: 14px; color: var(--clay-text); }
    .details dd.mono { font-family: 'Space Grotesk', monospace; }
    .details dd.overdue { color: var(--danger-text); font-weight: 600; }
    .desc { margin: 16px 0 0; padding-top: 14px; border-top: 1px solid var(--clay-border); font-size: 13px; color: var(--clay-text-secondary); line-height: 1.55; }

    .cta { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; background: var(--clay-primary); color: #fff; padding: 10px 18px; border-radius: var(--clay-radius-sm); font-size: 13px; font-weight: 600; }
    .cta mat-icon { font-size: 18px; width: 18px; height: 18px; }

    @media (max-width: 820px) { .ov-grid { grid-template-columns: 1fr; } .health { flex-direction: column; align-items: flex-start; } .comp { grid-template-columns: repeat(2, 1fr); } }
  `],
})
export class ProjectOverviewComponent {
  store = inject(ProjectWorkspaceStore);
  readonly CIRC = 2 * Math.PI * 52;

  project = this.store.project;
  prog = this.store.progress;

  pct = computed(() => this.prog()?.percentComplete ?? 0);
  offset = computed(() => this.CIRC * (1 - Math.min(100, Math.max(0, this.pct())) / 100));

  processName(): string {
    const id = this.project()?.processId;
    if (!id) return 'No process';
    return this.store.processes().find((p) => p.id === id)?.name ?? '—';
  }

  statusSegs() {
    const s = this.prog()?.status ?? ({} as Record<string, number>);
    return [
      { key: 'not_started', label: 'Not started', color: 'var(--clay-text-muted)', count: s['not_started'] ?? 0 },
      { key: 'in_progress', label: 'In progress', color: 'var(--warning)', count: s['in_progress'] ?? 0 },
      { key: 'ready_to_ship', label: 'Ready', color: 'var(--success)', count: s['ready_to_ship'] ?? 0 },
      { key: 'shipped', label: 'Shipped', color: 'var(--clay-primary-light)', count: s['shipped'] ?? 0 },
      { key: 'on_hold', label: 'On hold', color: 'var(--danger)', count: s['on_hold'] ?? 0 },
    ];
  }
  fabTotal(): number { return this.statusSegs().reduce((a, s) => a + s.count, 0); }

  ratio(n: number | null | undefined, total: number | null | undefined): number {
    return total && total > 0 ? Math.min(100, ((n ?? 0) / total) * 100) : 0;
  }
  kg(n: number | null | undefined): string { return Math.round(n ?? 0).toLocaleString(); }

  nextSteps(): NextStep[] {
    const steps: NextStep[] = [];
    const p = this.prog();
    if (!p) return steps;
    if ((p.workOrders ?? 0) === 0 && (p.nodes.assembly + p.nodes.subassembly) > 0) {
      steps.push({ icon: 'playlist_add', tone: 'blue', title: 'Generate work orders', detail: 'Route assemblies through a process to start tracking production.', cta: 'Assemblies', tab: 'assemblies' });
    }
    if (this.store.openNcr() > 0) {
      steps.push({ icon: 'report_problem', tone: 'danger', title: `${this.store.openNcr()} open NCR${this.store.openNcr() > 1 ? 's' : ''}`, detail: 'Quality issues need review before shipping.', cta: 'Quality', tab: 'quality' });
    }
    if (this.store.readyToShip() > 0) {
      steps.push({ icon: 'local_shipping', tone: 'green', title: `${this.store.readyToShip()} ready to ship`, detail: 'Assemblies have cleared all stages — build a load.', cta: 'Shipping', tab: 'shipping' });
    }
    if (this.store.isOverdue()) {
      steps.push({ icon: 'schedule', tone: 'orange', title: 'Past due date', detail: 'This job is overdue — review progress and timeline.', cta: 'Progress', tab: 'progress' });
    }
    return steps;
  }
}
