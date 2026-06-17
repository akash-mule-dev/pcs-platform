import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterModule } from '@angular/router';
import { QualityService } from '../quality-analysis/quality.service';

interface Insights {
  inspections30d: { total: number; pass: number; fail: number; warning: number };
  pendingSignoffs: number;
  firstPassYield: { ratePct: number | null; passedFirst: number; inspectedNodes: number };
  openNcrBySeverity: Record<string, number>;
  ncrAging: { under7: number; d7to30: number; over30: number };
  avgCloseDays90d: number | null;
  closed90d: number;
  topDefects: { defectType: string; count: number; failCount: number }[];
}

/** Org-level quality KPIs: first-pass yield, NCR aging/time-to-close, defect Pareto. */
@Component({
  selector: 'app-quality-insights',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule, RouterModule],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Quality Insights</h1>
          <p class="page-subtitle">First-pass yield, NCR aging and recurring defects across the shop</p>
        </div>
      </div>

      @if (loading) {
        <div class="center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (d) {
        <!-- KPI cards -->
        <div class="kpi-grid">
          <div class="kpi">
            <div class="kpi-icon tone-green"><mat-icon>verified</mat-icon></div>
            <div class="kt">
              <span class="kn">{{ d.firstPassYield.ratePct !== null ? d.firstPassYield.ratePct + '%' : '—' }}</span>
              <span class="kl">First-pass yield ({{ d.firstPassYield.passedFirst }}/{{ d.firstPassYield.inspectedNodes }} items)</span>
            </div>
          </div>
          <div class="kpi" [class.alert]="openNcrTotal > 0">
            <div class="kpi-icon" [class.tone-orange]="openNcrTotal === 0" [class.tone-danger]="openNcrTotal > 0"><mat-icon>report_problem</mat-icon></div>
            <div class="kt"><span class="kn">{{ openNcrTotal }}</span><span class="kl">Open NCRs</span></div>
          </div>
          <div class="kpi">
            <div class="kpi-icon tone-blue"><mat-icon>schedule</mat-icon></div>
            <div class="kt">
              <span class="kn">{{ d.avgCloseDays90d !== null ? d.avgCloseDays90d + 'd' : '—' }}</span>
              <span class="kl">Avg time to close ({{ d.closed90d }} closed, 90d)</span>
            </div>
          </div>
          <div class="kpi" [class.alert]="d.pendingSignoffs > 0">
            <div class="kpi-icon" [class.tone-blue]="d.pendingSignoffs === 0" [class.tone-orange]="d.pendingSignoffs > 0"><mat-icon>approval</mat-icon></div>
            <div class="kt"><span class="kn">{{ d.pendingSignoffs }}</span><span class="kl">Failures awaiting sign-off</span></div>
          </div>
        </div>

        <div class="panel-grid">
          <!-- Inspection mix, last 30 days -->
          <div class="panel">
            <h3>Inspections — last 30 days ({{ d.inspections30d.total }})</h3>
            @if (d.inspections30d.total > 0) {
              <div class="mix-bar">
                <span class="seg pass" [style.flex]="d.inspections30d.pass || 0.0001" title="Pass: {{ d.inspections30d.pass }}"></span>
                <span class="seg warning" [style.flex]="d.inspections30d.warning || 0.0001" title="Warning: {{ d.inspections30d.warning }}"></span>
                <span class="seg fail" [style.flex]="d.inspections30d.fail || 0.0001" title="Fail: {{ d.inspections30d.fail }}"></span>
              </div>
              <div class="legend">
                <span><i class="dot pass"></i>Pass {{ d.inspections30d.pass }}</span>
                <span><i class="dot warning"></i>Warning {{ d.inspections30d.warning }}</span>
                <span><i class="dot fail"></i>Fail {{ d.inspections30d.fail }}</span>
              </div>
            } @else { <p class="empty">No inspections recorded in the last 30 days.</p> }
          </div>

          <!-- Open NCRs by severity + aging -->
          <div class="panel">
            <h3>Open NCRs</h3>
            @if (openNcrTotal > 0) {
              <div class="rows">
                @for (s of severityOrder; track s) {
                  @if (d.openNcrBySeverity[s]) {
                    <div class="bar-row">
                      <span class="bar-label sev-{{ s }}">{{ s }}</span>
                      <div class="bar"><div class="fill sev-{{ s }}" [style.width.%]="pct(d.openNcrBySeverity[s], openNcrTotal)"></div></div>
                      <span class="bar-n">{{ d.openNcrBySeverity[s] }}</span>
                    </div>
                  }
                }
              </div>
              <h4>Aging</h4>
              <div class="aging">
                <div class="age"><span class="an">{{ d.ncrAging.under7 }}</span><span class="al">&lt; 7 days</span></div>
                <div class="age warn"><span class="an">{{ d.ncrAging.d7to30 }}</span><span class="al">7–30 days</span></div>
                <div class="age bad"><span class="an">{{ d.ncrAging.over30 }}</span><span class="al">&gt; 30 days</span></div>
              </div>
              <a class="link" routerLink="/quality-reports">Open QC Reports →</a>
            } @else { <p class="empty">Nothing open — gates are clear.</p> }
          </div>

          <!-- Defect Pareto -->
          <div class="panel wide">
            <h3>Top recurring defects</h3>
            @if (d.topDefects.length > 0) {
              <div class="rows">
                @for (t of d.topDefects; track t.defectType) {
                  <div class="bar-row">
                    <span class="bar-label">{{ t.defectType }}</span>
                    <div class="bar"><div class="fill defect" [style.width.%]="pct(t.count, d.topDefects[0].count)"></div></div>
                    <span class="bar-n">{{ t.count }} <em class="fail-n">({{ t.failCount }} fail)</em></span>
                  </div>
                }
              </div>
            } @else { <p class="empty">No defect types recorded yet.</p> }
          </div>
        </div>
      } @else {
        <p class="empty">Could not load quality insights.</p>
      }
    </div>
  `,
  styles: [`
    .page-shell { padding: 24px; }
    .page-header { margin-bottom: 16px; }
    .page-title { margin: 0; font-size: 22px; }
    .page-subtitle { margin: 2px 0 0; color: var(--clay-text-muted, #64748b); font-size: 13px; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { color: var(--clay-text-muted, #64748b); font-size: 13px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .kpi { display: flex; gap: 12px; align-items: center; background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 14px; }
    .kpi.alert { border-color: var(--danger, #dc2626); }
    .kpi-icon { width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
    .tone-green { background: var(--success-bg, #dcfce7); color: var(--success-text, #166534); }
    .tone-blue { background: var(--info-bg, #dbeafe); color: var(--info-text, #1d4ed8); }
    .tone-orange { background: var(--warning-bg, #fef3c7); color: var(--warning-text, #92400e); }
    .tone-danger { background: var(--danger-bg, #fee2e2); color: var(--danger-text, #b91c1c); }
    .kt { display: flex; flex-direction: column; }
    .kn { font-size: 22px; font-weight: 700; font-family: 'Space Grotesk', monospace; }
    .kl { font-size: 12px; color: var(--clay-text-muted, #64748b); }
    .panel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .panel { background: var(--clay-surface, #fff); border: 1px solid var(--clay-border, #e2e8f0); border-radius: 10px; padding: 16px; }
    .panel.wide { grid-column: 1 / -1; }
    @media (max-width: 900px) { .panel-grid { grid-template-columns: 1fr; } }
    h3 { margin: 0 0 12px; font-size: 14px; }
    h4 { margin: 14px 0 8px; font-size: 12.5px; color: var(--clay-text-muted, #64748b); }
    .mix-bar { display: flex; height: 18px; border-radius: 9px; overflow: hidden; }
    .seg.pass { background: var(--success, #16a34a); } .seg.warning { background: var(--warning, #d97706); } .seg.fail { background: var(--danger, #dc2626); }
    .legend { display: flex; gap: 16px; margin-top: 8px; font-size: 12px; color: var(--clay-text-secondary, #475569); }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 4px; margin-right: 4px; }
    .dot.pass { background: var(--success, #16a34a); } .dot.warning { background: var(--warning, #d97706); } .dot.fail { background: var(--danger, #dc2626); }
    .rows { display: flex; flex-direction: column; gap: 6px; }
    .bar-row { display: grid; grid-template-columns: 130px 1fr 90px; gap: 10px; align-items: center; font-size: 12.5px; }
    .bar-label { text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar { background: var(--clay-border, #eef2f7); border-radius: 6px; height: 12px; overflow: hidden; }
    .fill { height: 100%; border-radius: 6px; }
    .fill.defect { background: var(--clay-primary, #2563eb); }
    .fill.sev-low { background: #94a3b8; } .fill.sev-medium { background: #f59e0b; } .fill.sev-high { background: #f97316; } .fill.sev-critical { background: #dc2626; }
    .bar-n { font-family: 'Space Grotesk', monospace; font-weight: 600; }
    .fail-n { color: var(--danger-text, #b91c1c); font-style: normal; font-weight: 400; font-size: 11px; }
    .aging { display: flex; gap: 10px; }
    .age { flex: 1; text-align: center; border: 1px solid var(--clay-border, #e2e8f0); border-radius: 8px; padding: 8px; }
    .age.warn .an { color: var(--warning-text, #92400e); }
    .age.bad .an { color: var(--danger-text, #b91c1c); }
    .an { display: block; font-size: 18px; font-weight: 700; font-family: 'Space Grotesk', monospace; }
    .al { font-size: 11px; color: var(--clay-text-muted, #64748b); }
    .link { display: inline-block; margin-top: 12px; font-size: 12.5px; color: var(--clay-primary, #2563eb); text-decoration: none; cursor: pointer; }
  `],
})
export class QualityInsightsComponent implements OnInit {
  loading = true;
  d: Insights | null = null;
  readonly severityOrder = ['critical', 'high', 'medium', 'low'];

  constructor(private quality: QualityService) {}

  ngOnInit(): void {
    this.quality.getInsights().subscribe({
      next: (res) => { this.d = res; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  get openNcrTotal(): number {
    return Object.values(this.d?.openNcrBySeverity ?? {}).reduce((a, b) => a + b, 0);
  }

  pct(n: number, total: number): number {
    return total ? Math.max(4, Math.round((n / total) * 100)) : 0;
  }
}
