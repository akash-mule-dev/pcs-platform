import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Platform-level "Company Insights": cross-tenant adoption & usage analytics
 * for the org-less platform operator. Answers two questions a support/CS
 * operator actually has:
 *   1. How is each tenant using the system (volume, recency, who's active)?
 *   2. Which parts of the application are adopted vs dormant (per tenant and
 *      platform-wide), so onboarding / outreach can target the gaps?
 *
 * This is intentionally NOT tenant-scoped — it reads ACROSS organizations.
 * Everything is computed with grouped SQL aggregates (no N+1); usage volume
 * comes from per-feature row counts, activity/recency from the audit trail
 * (which has no organization_id, so it joins users → users.organization_id)
 * plus the work-order stage-event stream.
 */

/** A trackable application area → the table whose rows prove it's being used. */
interface FeatureDef {
  key: string;
  label: string;
  category: string;
  /** Source table (internal constant — safe to interpolate into SQL). */
  table: string;
}

/**
 * Every table here was verified to carry `organization_id` + `created_at`.
 * `models` / `coordination_packages` are deliberately omitted (no org column);
 * 3D adoption is represented by `import_files` instead.
 */
const FEATURES: FeatureDef[] = [
  // Fabrication
  { key: 'projects', label: 'Projects', category: 'Fabrication', table: 'projects' },
  { key: 'imports', label: '3D / CAD Imports', category: 'Fabrication', table: 'import_files' },
  { key: 'production_orders', label: 'Production Orders', category: 'Fabrication', table: 'production_orders' },
  { key: 'work_orders', label: 'Work Orders', category: 'Fabrication', table: 'work_orders' },
  { key: 'shipping', label: 'Shipping', category: 'Fabrication', table: 'shipments' },
  // Materials & costing
  { key: 'materials', label: 'Material Masters', category: 'Materials', table: 'materials' },
  { key: 'stock', label: 'Stock Movements', category: 'Materials', table: 'stock_movements' },
  { key: 'lots', label: 'Heat / Lot Traceability', category: 'Materials', table: 'material_lots' },
  // Quality
  { key: 'inspections', label: 'Quality Inspections', category: 'Quality', table: 'quality_data' },
  { key: 'ncrs', label: 'NCRs', category: 'Quality', table: 'ncrs' },
  { key: 'capas', label: 'CAPAs', category: 'Quality', table: 'capas' },
  // Configuration / setup
  { key: 'processes', label: 'Processes (Routing)', category: 'Configuration', table: 'processes' },
  { key: 'equipment', label: 'Equipment', category: 'Configuration', table: 'equipment' },
  { key: 'templates', label: 'Report Templates', category: 'Configuration', table: 'form_templates' },
  { key: 'custom_roles', label: 'Custom Roles', category: 'Configuration', table: 'roles' },
  // Shop floor
  { key: 'time_tracking', label: 'Time Tracking', category: 'Shop Floor', table: 'time_entries' },
  { key: 'shifts', label: 'Workforce Scheduling', category: 'Shop Floor', table: 'shift_assignments' },
];

/** A tenant counts as "recently active" within this window. */
const ACTIVE_WINDOW_DAYS = 30;
const TREND_WEEKS = 12;

type TenantStatus = 'active' | 'idle' | 'dormant';

const r1 = (n: number) => Math.round(n * 10) / 10;
const iso = (d: any): string | null => (d ? new Date(d).toISOString() : null);

@Injectable()
export class PlatformInsightsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Per-feature COUNT + MAX(created_at) grouped by org (optionally one org). */
  private featureUsageSql(scoped: boolean): string {
    const where = scoped ? 'organization_id = $1' : 'organization_id IS NOT NULL';
    return FEATURES.map(
      (f) =>
        `SELECT organization_id AS org, '${f.key}' AS feature, COUNT(*)::int AS cnt, MAX(created_at) AS last_at ` +
        `FROM ${f.table} WHERE ${where} GROUP BY organization_id`,
    ).join('\nUNION ALL\n');
  }

  private statusOf(featuresUsed: number, lastActivityAt: string | null): TenantStatus {
    if (featuresUsed === 0) return 'dormant';
    if (!lastActivityAt) return 'idle';
    const ageDays = (Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000;
    return ageDays <= ACTIVE_WINDOW_DAYS ? 'active' : 'idle';
  }

  // ── Cross-tenant overview ──────────────────────────────────────────────────
  async overview() {
    // Tenant organizations only (the platform library org is excluded).
    const orgs: any[] = await this.ds.query(
      `SELECT id, name, slug, is_active AS "isActive", description, created_at AS "createdAt",
              (settings ->> 'logoKey') IS NOT NULL AS "hasLogo"
         FROM organizations WHERE kind = 'tenant' ORDER BY created_at ASC`,
    );
    const tenantIds = new Set(orgs.map((o) => o.id));

    const [userRows, featureRows, auditRows, woseRows, trendRows] = await Promise.all([
      this.ds.query(
        `SELECT organization_id AS org, COUNT(*)::int AS users,
                COUNT(*) FILTER (WHERE is_active)::int AS active
           FROM users WHERE organization_id IS NOT NULL GROUP BY organization_id`,
      ),
      this.ds.query(this.featureUsageSql(false)),
      this.ds.query(
        `SELECT u.organization_id AS org, MAX(a.created_at) AS last_at,
                COUNT(*) FILTER (WHERE a.created_at > now() - interval '${ACTIVE_WINDOW_DAYS} days')::int AS e30,
                COUNT(*) FILTER (WHERE a.created_at > now() - interval '7 days')::int AS e7
           FROM audit_logs a JOIN users u ON u.id = a.user_id
          WHERE u.organization_id IS NOT NULL GROUP BY u.organization_id`,
      ),
      this.ds.query(
        `SELECT organization_id AS org, MAX(created_at) AS last_at
           FROM work_order_stage_events WHERE organization_id IS NOT NULL GROUP BY organization_id`,
      ),
      this.ds.query(
        `SELECT date_trunc('week', a.created_at) AS wk, COUNT(*)::int AS events
           FROM audit_logs a JOIN users u ON u.id = a.user_id
          WHERE u.organization_id IS NOT NULL AND a.created_at > now() - interval '${TREND_WEEKS} weeks'
          GROUP BY 1 ORDER BY 1`,
      ),
    ]);

    const userBy = new Map<string, { users: number; active: number }>();
    for (const u of userRows) userBy.set(u.org, { users: u.users, active: u.active });

    const auditBy = new Map<string, { last: any; e30: number; e7: number }>();
    for (const a of auditRows) auditBy.set(a.org, { last: a.last_at, e30: a.e30, e7: a.e7 });

    const woseBy = new Map<string, any>();
    for (const w of woseRows) woseBy.set(w.org, w.last_at);

    // Pivot feature usage into per-org maps + per-feature platform rollups.
    const recordsBy = new Map<string, Record<string, number>>();
    const lastByOrg = new Map<string, number>();
    const featureTotals = new Map<string, { tenantsUsing: number; totalRecords: number }>();
    for (const f of FEATURES) featureTotals.set(f.key, { tenantsUsing: 0, totalRecords: 0 });

    for (const row of featureRows) {
      if (!tenantIds.has(row.org)) continue; // ignore the platform/library org
      if (!recordsBy.has(row.org)) recordsBy.set(row.org, {});
      recordsBy.get(row.org)![row.feature] = row.cnt;
      if (row.last_at) {
        const t = new Date(row.last_at).getTime();
        lastByOrg.set(row.org, Math.max(lastByOrg.get(row.org) ?? 0, t));
      }
      const ft = featureTotals.get(row.feature);
      if (ft && row.cnt > 0) {
        ft.tenantsUsing += 1;
        ft.totalRecords += row.cnt;
      }
    }

    const tenants = orgs.map((o) => {
      const records = recordsBy.get(o.id) ?? {};
      const featuresUsed = FEATURES.filter((f) => (records[f.key] ?? 0) > 0).length;
      const audit = auditBy.get(o.id);
      const candidates = [lastByOrg.get(o.id), audit?.last ? new Date(audit.last).getTime() : undefined, woseBy.get(o.id) ? new Date(woseBy.get(o.id)).getTime() : undefined].filter(
        (x): x is number => typeof x === 'number',
      );
      const lastActivityAt = candidates.length ? iso(Math.max(...candidates)) : null;
      const u = userBy.get(o.id) ?? { users: 0, active: 0 };
      return {
        ...o,
        users: u.users,
        activeUsers: u.active,
        records,
        featuresUsed,
        featuresTotal: FEATURES.length,
        events30d: audit?.e30 ?? 0,
        events7d: audit?.e7 ?? 0,
        lastActivityAt,
        status: this.statusOf(featuresUsed, lastActivityAt),
      };
    });

    const activeTenants = tenants.filter((t) => t.isActive).length;
    const features = FEATURES.map((f) => {
      const ft = featureTotals.get(f.key)!;
      return {
        key: f.key,
        label: f.label,
        category: f.category,
        tenantsUsing: ft.tenantsUsing,
        totalRecords: ft.totalRecords,
        adoptionPct: tenants.length ? r1((ft.tenantsUsing / tenants.length) * 100) : 0,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        tenants: tenants.length,
        activeTenants,
        inactiveTenants: tenants.length - activeTenants,
        users: tenants.reduce((s, t) => s + t.users, 0),
        activeUsers: tenants.reduce((s, t) => s + t.activeUsers, 0),
        activeLast30d: tenants.filter((t) => t.status === 'active').length,
        idleTenants: tenants.filter((t) => t.status === 'idle').length,
        dormantTenants: tenants.filter((t) => t.status === 'dormant').length,
        dormantFeatures: features.filter((f) => f.tenantsUsing === 0).length,
      },
      features,
      trend: trendRows.map((t: any) => ({ weekStart: iso(t.wk)!.slice(0, 10), events: t.events })),
      tenants,
    };
  }

  // ── Per-tenant deep dive ────────────────────────────────────────────────────
  async tenant(orgId: string) {
    const orgRows: any[] = await this.ds.query(
      `SELECT id, name, slug, kind, is_active AS "isActive", description, created_at AS "createdAt",
              (settings ->> 'logoKey') IS NOT NULL AS "hasLogo"
         FROM organizations WHERE id = $1`,
      [orgId],
    );
    const org = orgRows[0];
    if (!org) throw new NotFoundException('Organization not found');
    if (org.kind === 'platform') throw new NotFoundException('The platform organization has no tenant insights');

    const [userTotals, byRole, featureRows, activity, trendRows, byType, topUsers] = await Promise.all([
      this.ds.query(
        `SELECT COUNT(*)::int AS users, COUNT(*) FILTER (WHERE is_active)::int AS active
           FROM users WHERE organization_id = $1`,
        [orgId],
      ),
      this.ds.query(
        `SELECT r.name AS role, COUNT(*)::int AS count
           FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.organization_id = $1 GROUP BY r.name ORDER BY count DESC`,
        [orgId],
      ),
      this.ds.query(this.featureUsageSql(true), [orgId]),
      this.ds.query(
        `SELECT MAX(a.created_at) AS last_at,
                COUNT(*) FILTER (WHERE a.created_at > now() - interval '${ACTIVE_WINDOW_DAYS} days')::int AS e30,
                COUNT(*) FILTER (WHERE a.created_at > now() - interval '7 days')::int AS e7,
                COUNT(*)::int AS total
           FROM audit_logs a JOIN users u ON u.id = a.user_id WHERE u.organization_id = $1`,
        [orgId],
      ),
      this.ds.query(
        `SELECT date_trunc('week', a.created_at) AS wk, COUNT(*)::int AS events
           FROM audit_logs a JOIN users u ON u.id = a.user_id
          WHERE u.organization_id = $1 AND a.created_at > now() - interval '${TREND_WEEKS} weeks'
          GROUP BY 1 ORDER BY 1`,
        [orgId],
      ),
      this.ds.query(
        `SELECT a.entity_type AS "entityType", a.action, COUNT(*)::int AS count
           FROM audit_logs a JOIN users u ON u.id = a.user_id
          WHERE u.organization_id = $1 AND a.created_at > now() - interval '90 days'
          GROUP BY a.entity_type, a.action ORDER BY count DESC LIMIT 20`,
        [orgId],
      ),
      this.ds.query(
        `SELECT u.id, u.first_name AS "firstName", u.last_name AS "lastName", u.email, COUNT(*)::int AS events
           FROM audit_logs a JOIN users u ON u.id = a.user_id
          WHERE u.organization_id = $1 AND a.created_at > now() - interval '90 days'
          GROUP BY u.id, u.first_name, u.last_name, u.email ORDER BY events DESC LIMIT 8`,
        [orgId],
      ),
    ]);

    const recordsBy: Record<string, { cnt: number; lastAt: string | null }> = {};
    for (const row of featureRows) recordsBy[row.feature] = { cnt: row.cnt, lastAt: iso(row.last_at) };

    const features = FEATURES.map((f) => {
      const rec = recordsBy[f.key];
      return {
        key: f.key,
        label: f.label,
        category: f.category,
        records: rec?.cnt ?? 0,
        lastAt: rec?.lastAt ?? null,
        used: (rec?.cnt ?? 0) > 0,
      };
    });
    const featuresUsed = features.filter((f) => f.used).length;

    const act = activity[0] ?? {};
    const featureLast = features.map((f) => (f.lastAt ? new Date(f.lastAt).getTime() : 0));
    const lastCandidates = [act.last_at ? new Date(act.last_at).getTime() : 0, ...featureLast].filter((x) => x > 0);
    const lastActivityAt = lastCandidates.length ? iso(Math.max(...lastCandidates)) : null;

    return {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        isActive: org.isActive,
        description: org.description,
        hasLogo: org.hasLogo,
        createdAt: iso(org.createdAt),
      },
      status: this.statusOf(featuresUsed, lastActivityAt),
      users: {
        total: userTotals[0]?.users ?? 0,
        active: userTotals[0]?.active ?? 0,
        byRole: byRole.map((b: any) => ({ role: b.role, count: b.count })),
      },
      adoption: { featuresUsed, featuresTotal: FEATURES.length },
      features,
      activity: {
        lastActivityAt,
        events7d: act.e7 ?? 0,
        events30d: act.e30 ?? 0,
        events90d: act.total ?? 0,
        trend: trendRows.map((t: any) => ({ weekStart: iso(t.wk)!.slice(0, 10), events: t.events })),
        byType: byType.map((b: any) => ({ entityType: b.entityType, action: b.action, count: b.count })),
        topUsers: topUsers.map((u: any) => ({
          id: u.id,
          name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || 'Unknown',
          email: u.email,
          events: u.events,
        })),
      },
    };
  }
}
