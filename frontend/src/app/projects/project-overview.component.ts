import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ProjectWorkspaceStore } from './project-workspace.store';
import { ThreeViewerComponent } from '../shared/components/three-viewer/three-viewer.component';

/**
 * Overview tab — the project is a pure design container, so this shows design
 * facts only: composition, 3D preview and project details. Production tracking
 * (progress, quality, shipping) lives inside each work order.
 */
@Component({
  selector: 'app-project-overview',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, ThreeViewerComponent],
  template: `
    @if (store.hasNodes()) {
      <div class="ov-grid">
        <!-- Composition -->
        <section class="card">
          <h3>Composition</h3>
          <div class="comp">
            <div class="comp-cell"><span class="c-num">{{ prog()?.nodes?.assembly ?? 0 }}</span><span class="c-lbl">Assemblies</span></div>
            <div class="comp-cell"><span class="c-num">{{ prog()?.nodes?.subassembly ?? 0 }}</span><span class="c-lbl">Sub-assemblies</span></div>
            <div class="comp-cell"><span class="c-num">{{ prog()?.nodes?.part ?? 0 }}</span><span class="c-lbl">Parts</span></div>
            <div class="comp-cell"><span class="c-num">{{ kg(prog()?.tonnage?.totalKg) }}</span><span class="c-lbl">Total kg</span></div>
          </div>
        </section>

        <!-- Attached work orders -->
        <section class="card">
          <div class="card-head"><h3>Work orders</h3><a class="head-link" [routerLink]="['/projects', store.id(), 'orders']">Open<mat-icon>chevron_right</mat-icon></a></div>
          <div class="wo">
            <span class="wo-num">{{ store.ordersCount() }}</span>
            <p class="wo-hint">Production runs attached to this design. Each tracks its own board, progress, quality and shipping.</p>
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
            <div><dt>Created</dt><dd>{{ project()?.createdAt | date:'mediumDate' }}</dd></div>
          </dl>
          @if (project()?.description) { <p class="desc">{{ project()?.description }}</p> }
        </section>
      </div>
    } @else {
      <div class="empty-state">
        <mat-icon>account_tree</mat-icon>
        <h3>No assemblies yet</h3>
        <p>Import an IFC file to build this project's assembly tree and 3D model — or skip the model and start tracking production right away.</p>
        <div class="empty-ctas">
          <a class="cta" [routerLink]="['/projects', store.id(), 'assemblies']"><mat-icon>upload_file</mat-icon>Import an IFC file</a>
          <a class="cta secondary" [routerLink]="['/projects', store.id(), 'orders']"><mat-icon>receipt_long</mat-icon>Create a work order without a model</a>
        </div>
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

    /* Composition */
    .comp { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .comp-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 12px 6px; background: var(--clay-bg-warm); border-radius: var(--clay-radius-sm); }
    .c-num { font-size: 22px; font-weight: 700; color: var(--clay-text); font-family: 'Space Grotesk','Inter',sans-serif; }
    .c-lbl { font-size: 11px; color: var(--clay-text-muted); text-align: center; }

    /* Work orders */
    .wo { display: flex; align-items: center; gap: 16px; }
    .wo-num { font-size: 34px; font-weight: 700; color: var(--clay-primary); font-family: 'Space Grotesk','Inter',sans-serif; }
    .wo-hint { margin: 0; font-size: 12px; color: var(--clay-text-muted); line-height: 1.5; }

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
    .desc { margin: 16px 0 0; padding-top: 14px; border-top: 1px solid var(--clay-border); font-size: 13px; color: var(--clay-text-secondary); line-height: 1.55; }

    .empty-ctas { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
    .cta { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; background: var(--clay-primary); color: #fff; padding: 10px 18px; border-radius: var(--clay-radius-sm); font-size: 13px; font-weight: 600; }
    .cta.secondary { background: transparent; color: var(--clay-primary); border: 1px solid var(--clay-primary); }
    .cta mat-icon { font-size: 18px; width: 18px; height: 18px; }

    @media (max-width: 820px) { .ov-grid { grid-template-columns: 1fr; } .comp { grid-template-columns: repeat(2, 1fr); } }
  `],
})
export class ProjectOverviewComponent {
  store = inject(ProjectWorkspaceStore);

  project = this.store.project;
  prog = this.store.progress;

  kg(n: number | null | undefined): string { return Math.round(n ?? 0).toLocaleString(); }
}
