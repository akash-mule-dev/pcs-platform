import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  PlatformInsightsService, PlatformOverview, FeatureAdoption, TenantRow, TenantInsight, TenantStatus,
} from './platform-insights.service';

interface FeatureGroup { category: string; features: FeatureAdoption[]; }

@Component({
  selector: 'app-platform-insights',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="page-shell">
      <div class="page-header">
        <div>
          <h1 class="page-title">Company Insights</h1>
          <p class="page-subtitle">How each tenant uses the platform — adoption, engagement, and the features no one has touched yet.</p>
        </div>
        <div class="header-actions">
          @if (data) { <span class="generated">Updated {{ relative(data.generatedAt) }}</span> }
          <button mat-stroked-button (click)="load()" [disabled]="loading"><mat-icon>refresh</mat-icon> Refresh</button>
        </div>
      </div>

      @if (loading && !data) {
        <div class="center"><mat-spinner diameter="36"></mat-spinner></div>
      } @else if (error) {
        <div class="error-box"><mat-icon>error_outline</mat-icon> {{ error }}</div>
      } @else if (data) {
        <!-- KPI cards -->
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">Tenants</div><div class="kpi-value">{{ data.totals.tenants }}</div>
            <div class="kpi-sub">{{ data.totals.activeTenants }} active · {{ data.totals.inactiveTenants }} inactive</div></div>
          <div class="kpi"><div class="kpi-label">Users</div><div class="kpi-value">{{ data.totals.users }}</div>
            <div class="kpi-sub">{{ data.totals.activeUsers }} active</div></div>
          <div class="kpi good"><div class="kpi-label">Logins (30d)</div><div class="kpi-value">{{ data.totals.usersLoggedIn30d }}</div>
            <div class="kpi-sub">of {{ data.totals.users }} users signed in</div></div>
          <div class="kpi good"><div class="kpi-label">Active (30d)</div><div class="kpi-value">{{ data.totals.activeLast30d }}</div>
            <div class="kpi-sub">tenants engaged</div></div>
          <div class="kpi warn"><div class="kpi-label">Idle</div><div class="kpi-value">{{ data.totals.idleTenants }}</div>
            <div class="kpi-sub">no activity in 30d</div></div>
          <div class="kpi bad"><div class="kpi-label">Dormant</div><div class="kpi-value">{{ data.totals.dormantTenants }}</div>
            <div class="kpi-sub">provisioned, unused</div></div>
          <div class="kpi"><div class="kpi-label">Unused features</div><div class="kpi-value">{{ data.totals.dormantFeatures }}</div>
            <div class="kpi-sub">of {{ data.features.length }} tracked</div></div>
        </div>

        <!-- Platform activity trend -->
        <div class="panel">
          <div class="panel-head"><h3>Platform activity</h3><span class="muted">recorded events / week (last 12 weeks)</span></div>
          @if (maxTrend(data.trend) > 0) {
            <div class="bars">
              @for (p of data.trend; track p.weekStart) {
                <div class="bar-col" [matTooltip]="p.events + ' events · week of ' + p.weekStart">
                  <div class="bar" [style.height.%]="barH(p.events, maxTrend(data.trend))"></div>
                  <div class="bar-x">{{ p.weekStart | date:'MMM d' }}</div>
                </div>
              }
            </div>
          } @else { <p class="empty-inline">No recorded activity yet.</p> }
        </div>

        <!-- Feature adoption matrix -->
        <div class="panel">
          <div class="panel-head"><h3>Feature adoption</h3><span class="muted">how many tenants have used each part of the app</span></div>
          @for (g of featureGroups; track g.category) {
            <div class="fg">
              <div class="fg-cat">{{ g.category }}</div>
              <div class="fg-rows">
                @for (f of g.features; track f.key) {
                  <div class="adopt-row" [class.dormant]="f.tenantsUsing === 0">
                    <div class="adopt-label">
                      {{ f.label }}
                      @if (f.tenantsUsing === 0) { <span class="tag dormant-tag">Unused</span> }
                    </div>
                    <div class="adopt-bar-wrap">
                      <div class="adopt-bar" [style.width.%]="f.adoptionPct"></div>
                    </div>
                    <div class="adopt-meta">
                      <span class="adopt-tn">{{ f.tenantsUsing }}/{{ data.totals.tenants }} tenants</span>
                      <span class="adopt-rec">{{ f.totalRecords | number }} records</span>
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        </div>

        <!-- Tenants -->
        <div class="panel">
          <div class="panel-head"><h3>Tenants</h3><span class="muted">click a row to drill into usage</span></div>
          <table class="tbl">
            <thead><tr>
              <th>Company</th><th>Status</th><th class="num">Users</th><th>Adoption</th><th>Last login</th><th>Last activity</th><th class="num">30d events</th><th></th>
            </tr></thead>
            <tbody>
              @for (t of data.tenants; track t.id) {
                <tr (click)="select(t)" [class.sel]="selectedId === t.id" class="clickable">
                  <td>
                    <div class="org-cell">
                      <span class="avatar">{{ initials(t.name) }}</span>
                      <div><div class="org-name">{{ t.name }}</div><code>{{ t.slug }}</code></div>
                    </div>
                  </td>
                  <td><span class="status" [ngClass]="t.status">{{ t.status }}</span>
                    @if (!t.isActive) { <span class="status off">inactive</span> }</td>
                  <td class="num">{{ t.users }}</td>
                  <td>
                    <div class="mini-wrap" [matTooltip]="t.featuresUsed + ' of ' + t.featuresTotal + ' features used'">
                      <div class="mini-bar"><div class="mini-fill" [style.width.%]="(t.featuresUsed / t.featuresTotal) * 100"></div></div>
                      <span class="mini-txt">{{ t.featuresUsed }}/{{ t.featuresTotal }}</span>
                    </div>
                  </td>
                  <td [matTooltip]="t.usersActive30d + ' of ' + t.users + ' users signed in (30d)'">{{ t.lastLoginAt ? relative(t.lastLoginAt) : 'never' }}</td>
                  <td>{{ t.lastActivityAt ? relative(t.lastActivityAt) : '—' }}</td>
                  <td class="num">{{ t.events30d }}</td>
                  <td><button mat-button color="primary">Details <mat-icon>chevron_right</mat-icon></button></td>
                </tr>
              }
            </tbody>
          </table>
          @if (!data.tenants.length) { <p class="empty-inline">No tenants provisioned yet.</p> }
        </div>
      }
    </div>

    <!-- Tenant detail drawer -->
    @if (selectedId) {
      <div class="drawer-scrim" (click)="closeDetail()"></div>
      <aside class="drawer">
        <div class="drawer-head">
          <div>
            <h2>{{ detail?.organization?.name || 'Loading…' }}</h2>
            @if (detail) { <span class="status" [ngClass]="detail.status">{{ detail.status }}</span> }
          </div>
          <button mat-icon-button (click)="closeDetail()"><mat-icon>close</mat-icon></button>
        </div>

        @if (detailLoading) {
          <div class="center"><mat-spinner diameter="30"></mat-spinner></div>
        } @else if (detail) {
          <div class="d-kpis">
            <div class="d-kpi"><span>{{ detail.users.active }}/{{ detail.users.total }}</span><label>Active users</label></div>
            <div class="d-kpi"><span>{{ detail.adoption.featuresUsed }}/{{ detail.adoption.featuresTotal }}</span><label>Features used</label></div>
            <div class="d-kpi"><span>{{ detail.activity.events7d }}</span><label>Events (7d)</label></div>
            <div class="d-kpi"><span>{{ detail.activity.events30d }}</span><label>Events (30d)</label></div>
          </div>
          <p class="last-seen">Last login: <strong>{{ detail.users.lastLoginAt ? relative(detail.users.lastLoginAt) : 'never' }}</strong>
            · Last activity: <strong>{{ detail.activity.lastActivityAt ? relative(detail.activity.lastActivityAt) : 'never' }}</strong></p>

          <h4>Activity (12 weeks)</h4>
          @if (maxTrend(detail.activity.trend) > 0) {
            <div class="bars sm">
              @for (p of detail.activity.trend; track p.weekStart) {
                <div class="bar-col" [matTooltip]="p.events + ' events · week of ' + p.weekStart">
                  <div class="bar" [style.height.%]="barH(p.events, maxTrend(detail.activity.trend))"></div>
                </div>
              }
            </div>
          } @else { <p class="empty-inline">No recorded activity.</p> }

          <h4>Team <span class="h4-sub">{{ detail.users.loggedIn30d }}/{{ detail.users.total }} signed in (30d)</span></h4>
          <div class="chips">
            @for (r of detail.users.byRole; track r.role) { <span class="chip">{{ r.role }} · {{ r.count }}</span> }
          </div>
          @if (detail.activity.topUsers.length) {
            <div class="top-users">
              @for (u of detail.activity.topUsers; track u.id) {
                <div class="tu">
                  <span class="tu-name">{{ u.name }}</span>
                  <span class="tu-ev">{{ u.events }} events · {{ u.lastLoginAt ? 'login ' + relative(u.lastLoginAt) : 'no login' }}</span>
                </div>
              }
            </div>
          }

          <h4>Feature usage</h4>
          <div class="feat-grid">
            @for (f of detail.features; track f.key) {
              <div class="feat" [class.unused]="!f.used">
                <mat-icon>{{ f.used ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
                <div class="feat-body"><span class="feat-label">{{ f.label }}</span>
                  <span class="feat-sub">{{ f.used ? (f.records | number) + ' records · ' + relative(f.lastAt!) : 'never used' }}</span>
                </div>
              </div>
            }
          </div>

          @if (detail.activity.byType.length) {
            <h4>Recent actions (90 days)</h4>
            <div class="bytype">
              @for (b of detail.activity.byType; track b.entityType + b.action) {
                <div class="bt-row"><span class="bt-ent">{{ b.entityType }}</span><span class="bt-act">{{ b.action }}</span><span class="bt-cnt">{{ b.count }}</span></div>
              }
            </div>
          }
        }
      </aside>
    }
  `,
  styles: [`
    .page-shell { padding:24px; }
    .page-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; gap:16px; flex-wrap:wrap; }
    .page-title { margin:0; font-size:22px; } .page-subtitle { margin:2px 0 0; color:var(--clay-text-muted,#64748b); font-size:13px; max-width:640px; }
    .header-actions { display:flex; align-items:center; gap:12px; } .generated { font-size:12px; color:var(--clay-text-muted,#64748b); }
    .center { display:flex; justify-content:center; padding:48px; }
    .error-box { display:flex; align-items:center; gap:8px; background:#fef2f2; color:#b91c1c; padding:14px 16px; border-radius:8px; }

    .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:16px; }
    .kpi { background:var(--clay-surface,#fff); border:1px solid var(--clay-border,#e2e8f0); border-radius:10px; padding:14px 16px; border-left:3px solid var(--clay-border,#e2e8f0); }
    .kpi.good { border-left-color:#16a34a; } .kpi.warn { border-left-color:#d97706; } .kpi.bad { border-left-color:#dc2626; }
    .kpi-label { font-size:12px; color:var(--clay-text-muted,#64748b); text-transform:uppercase; letter-spacing:.04em; }
    .kpi-value { font-size:26px; font-weight:700; line-height:1.2; margin-top:2px; } .kpi-sub { font-size:12px; color:var(--clay-text-muted,#64748b); }

    .panel { background:var(--clay-surface,#fff); border:1px solid var(--clay-border,#e2e8f0); border-radius:10px; padding:16px 18px; margin-bottom:16px; }
    .panel-head { display:flex; align-items:baseline; gap:10px; margin-bottom:14px; } .panel-head h3 { margin:0; font-size:15px; }
    .muted { color:var(--clay-text-muted,#64748b); font-size:12px; }
    .empty-inline { color:var(--clay-text-muted,#64748b); font-size:13px; padding:8px 0; }

    .bars { display:flex; align-items:flex-end; gap:6px; height:120px; padding-top:8px; }
    .bars.sm { height:70px; gap:4px; }
    .bar-col { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; min-width:8px; }
    .bar { width:60%; min-height:2px; background:var(--clay-primary,#2563eb); border-radius:3px 3px 0 0; transition:height .2s; }
    .bar-x { font-size:10px; color:var(--clay-text-muted,#94a3b8); margin-top:4px; white-space:nowrap; }

    .fg { display:flex; gap:16px; padding:10px 0; border-top:1px solid var(--clay-bg,#f1f5f9); }
    .fg:first-child { border-top:none; }
    .fg-cat { width:120px; flex:none; font-size:12px; font-weight:600; color:var(--clay-text,#334155); padding-top:4px; }
    .fg-rows { flex:1; display:flex; flex-direction:column; gap:8px; }
    .adopt-row { display:grid; grid-template-columns:200px 1fr 200px; gap:12px; align-items:center; }
    .adopt-label { font-size:13px; } .adopt-row.dormant .adopt-label { color:var(--clay-text-muted,#94a3b8); }
    .tag { font-size:10px; padding:1px 6px; border-radius:8px; margin-left:6px; vertical-align:middle; }
    .dormant-tag { background:#fee2e2; color:#b91c1c; }
    .adopt-bar-wrap { background:var(--clay-bg,#f1f5f9); border-radius:6px; height:10px; overflow:hidden; }
    .adopt-bar { height:100%; background:var(--clay-primary,#2563eb); border-radius:6px; min-width:0; }
    .adopt-row.dormant .adopt-bar { background:transparent; }
    .adopt-meta { display:flex; justify-content:space-between; font-size:12px; color:var(--clay-text-muted,#64748b); }

    .tbl { width:100%; border-collapse:collapse; }
    .tbl th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--clay-text-muted,#64748b); padding:6px 10px; border-bottom:1px solid var(--clay-border,#e2e8f0); }
    .tbl th.num, .tbl td.num { text-align:right; }
    .tbl td { padding:10px; border-bottom:1px solid var(--clay-bg,#f1f5f9); font-size:13px; }
    tr.clickable { cursor:pointer; } tr.clickable:hover { background:var(--clay-bg,#f8fafc); } tr.sel { background:var(--clay-primary-soft,#eff6ff); }
    .org-cell { display:flex; align-items:center; gap:10px; }
    .avatar { width:30px; height:30px; border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; color:var(--clay-primary,#2563eb); background:var(--clay-primary-soft,#eff6ff); flex:none; }
    .org-name { font-weight:600; } code { background:var(--clay-bg,#f1f5f9); padding:0 5px; border-radius:4px; font-size:11px; color:var(--clay-text-muted,#64748b); }
    .status { font-size:11px; font-weight:600; padding:2px 9px; border-radius:10px; text-transform:capitalize; }
    .status.active { background:#dcfce7; color:#15803d; } .status.idle { background:#fef3c7; color:#b45309; }
    .status.dormant { background:#fee2e2; color:#b91c1c; } .status.off { background:#f1f5f9; color:#64748b; margin-left:6px; }
    .mini-wrap { display:flex; align-items:center; gap:8px; }
    .mini-bar { width:90px; height:8px; background:var(--clay-bg,#f1f5f9); border-radius:4px; overflow:hidden; }
    .mini-fill { height:100%; background:var(--clay-primary,#2563eb); } .mini-txt { font-size:12px; color:var(--clay-text-muted,#64748b); }

    .drawer-scrim { position:fixed; inset:0; background:rgba(15,23,42,.4); z-index:1000; }
    .drawer { position:fixed; top:0; right:0; height:100vh; width:min(460px,94vw); background:var(--clay-surface,#fff); box-shadow:-4px 0 24px rgba(0,0,0,.15); z-index:1001; overflow-y:auto; padding:20px; }
    .drawer-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; }
    .drawer-head h2 { margin:0 0 6px; font-size:18px; }
    .drawer h4 { margin:20px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--clay-text-muted,#64748b); }
    .h4-sub { font-weight:400; text-transform:none; letter-spacing:0; color:var(--clay-text-muted,#94a3b8); font-size:11px; margin-left:6px; }
    .d-kpis { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; }
    .d-kpi { background:var(--clay-bg,#f8fafc); border-radius:8px; padding:10px 12px; } .d-kpi span { font-size:20px; font-weight:700; } .d-kpi label { display:block; font-size:11px; color:var(--clay-text-muted,#64748b); }
    .last-seen { font-size:13px; margin:12px 0 0; color:var(--clay-text-muted,#64748b); }
    .chips { display:flex; flex-wrap:wrap; gap:6px; } .chip { background:var(--clay-primary-soft,#eff6ff); color:var(--clay-primary,#2563eb); font-size:12px; padding:3px 10px; border-radius:10px; text-transform:capitalize; }
    .top-users { margin-top:10px; } .tu { display:flex; justify-content:space-between; font-size:13px; padding:5px 0; border-bottom:1px solid var(--clay-bg,#f1f5f9); }
    .tu-ev { color:var(--clay-text-muted,#64748b); font-size:12px; }
    .feat-grid { display:flex; flex-direction:column; gap:6px; }
    .feat { display:flex; align-items:center; gap:10px; } .feat mat-icon { color:#16a34a; font-size:20px; height:20px; width:20px; }
    .feat.unused { opacity:.55; } .feat.unused mat-icon { color:var(--clay-text-muted,#94a3b8); }
    .feat-body { display:flex; flex-direction:column; } .feat-label { font-size:13px; } .feat-sub { font-size:11px; color:var(--clay-text-muted,#64748b); }
    .bytype { display:flex; flex-direction:column; }
    .bt-row { display:grid; grid-template-columns:1fr auto 40px; gap:8px; font-size:12px; padding:4px 0; border-bottom:1px solid var(--clay-bg,#f1f5f9); }
    .bt-ent { color:var(--clay-text,#334155); } .bt-act { color:var(--clay-text-muted,#64748b); } .bt-cnt { text-align:right; font-weight:600; }
  `],
})
export class PlatformInsightsComponent implements OnInit {
  loading = false;
  error = '';
  data: PlatformOverview | null = null;
  featureGroups: FeatureGroup[] = [];

  selectedId: string | null = null;
  detail: TenantInsight | null = null;
  detailLoading = false;

  constructor(private api: PlatformInsightsService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.overview().subscribe({
      next: (d) => { this.data = d; this.featureGroups = this.groupFeatures(d.features); this.loading = false; },
      error: (e) => { this.error = e?.error?.message || 'Could not load insights'; this.loading = false; },
    });
  }

  private groupFeatures(features: FeatureAdoption[]): FeatureGroup[] {
    const order: string[] = [];
    const map = new Map<string, FeatureAdoption[]>();
    for (const f of features) {
      if (!map.has(f.category)) { map.set(f.category, []); order.push(f.category); }
      map.get(f.category)!.push(f);
    }
    return order.map((category) => ({ category, features: map.get(category)! }));
  }

  select(t: TenantRow): void {
    this.selectedId = t.id;
    this.detail = null;
    this.detailLoading = true;
    this.api.tenant(t.id).subscribe({
      next: (d) => { this.detail = d; this.detailLoading = false; },
      error: () => { this.detailLoading = false; this.closeDetail(); },
    });
  }

  closeDetail(): void { this.selectedId = null; this.detail = null; }

  maxTrend(trend: { events: number }[]): number {
    return trend.reduce((m, p) => Math.max(m, p.events), 0);
  }
  barH(events: number, max: number): number {
    return max > 0 ? Math.max(4, Math.round((events / max) * 100)) : 0;
  }

  initials(name: string): string {
    return (name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  }

  relative(iso: string): string {
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '—';
    const s = Math.max(0, (Date.now() - then) / 1000);
    if (s < 60) return 'just now';
    const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
    const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
    const d = h / 24; if (d < 7) return `${Math.floor(d)}d ago`;
    const w = d / 7; if (w < 5) return `${Math.floor(w)}w ago`;
    const mo = d / 30; if (mo < 12) return `${Math.floor(mo)}mo ago`;
    return `${Math.floor(d / 365)}y ago`;
  }
}
