import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QualityData } from './quality-data.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

export interface QualityInsights {
  inspections30d: { total: number; pass: number; fail: number; warning: number };
  pendingSignoffs: number;
  firstPassYield: { ratePct: number | null; passedFirst: number; inspectedNodes: number };
  openNcrBySeverity: Record<string, number>;
  ncrAging: { under7: number; d7to30: number; over30: number };
  avgCloseDays90d: number | null;
  closed90d: number;
  topDefects: { defectType: string; count: number; failCount: number }[];
}

/**
 * Org-level quality KPIs for the insights page — first-pass yield, NCR aging
 * and time-to-close, defect Pareto, recent inspection mix. A handful of small
 * aggregate queries; everything tenant-scoped.
 */
@Injectable()
export class QualityInsightsService {
  constructor(@InjectRepository(QualityData) private readonly repo: Repository<QualityData>) {}

  async insights(): Promise<QualityInsights> {
    const org = TenantContext.getOrganizationId();
    // Tenant filter fragments — org-less (dev/system) contexts see everything.
    const qdOrg = org ? `AND organization_id = $1` : '';
    const p = org ? [org] : [];

    const [mix] = await this.repo.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'pass')::int AS pass,
              COUNT(*) FILTER (WHERE status = 'fail')::int AS fail,
              COUNT(*) FILTER (WHERE status = 'warning')::int AS warning
         FROM quality_data
        WHERE is_active = true AND created_at > now() - interval '30 days' ${qdOrg}`,
      p,
    );

    const [pending] = await this.repo.query(
      `SELECT COUNT(*)::int AS n FROM quality_data
        WHERE is_active = true AND status = 'fail' AND signoff_status = 'pending' ${qdOrg}`,
      p,
    );

    // First-pass yield: of assemblies with inspections, how many PASSED their
    // very first recorded inspection.
    const [fpy] = await this.repo.query(
      `WITH firsts AS (
         SELECT DISTINCT ON (assembly_node_id) assembly_node_id, status
           FROM quality_data
          WHERE is_active = true AND assembly_node_id IS NOT NULL ${qdOrg}
          ORDER BY assembly_node_id, created_at ASC
       )
       SELECT COUNT(*)::int AS inspected,
              COUNT(*) FILTER (WHERE status = 'pass')::int AS passed
         FROM firsts`,
      p,
    );
    const inspectedNodes = Number(fpy?.inspected ?? 0);
    const passedFirst = Number(fpy?.passed ?? 0);

    // NCRs are now NCR-type QC reports (open = unresolved). Severity rides in the
    // filled form data (`data->>'severity'`); created_at/resolved_at drive aging.
    const sevRows: { severity: string; n: string }[] = await this.repo.query(
      `SELECT COALESCE(NULLIF(data->>'severity', ''), 'unspecified') AS severity, COUNT(*)::int AS n
         FROM quality_reports
        WHERE template_type = 'ncr' AND resolved_at IS NULL ${qdOrg}
        GROUP BY COALESCE(NULLIF(data->>'severity', ''), 'unspecified')`,
      p,
    );
    const openNcrBySeverity: Record<string, number> = {};
    for (const r of sevRows) openNcrBySeverity[r.severity] = Number(r.n);

    const [aging] = await this.repo.query(
      `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS under7,
              COUNT(*) FILTER (WHERE created_at <= now() - interval '7 days' AND created_at > now() - interval '30 days')::int AS d7to30,
              COUNT(*) FILTER (WHERE created_at <= now() - interval '30 days')::int AS over30
         FROM quality_reports
        WHERE template_type = 'ncr' AND resolved_at IS NULL ${qdOrg}`,
      p,
    );

    // Genuine closures only — exclude NCRs voided via Cancel (also stamp resolved_at).
    const [closeStats] = await this.repo.query(
      `SELECT COUNT(*)::int AS n,
              AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400.0) AS avg_days
         FROM quality_reports
        WHERE template_type = 'ncr' AND resolved_at IS NOT NULL
          AND (ncr_status IS NULL OR ncr_status <> 'cancelled')
          AND resolved_at > now() - interval '90 days' ${qdOrg}`,
      p,
    );

    const defects: { defect_type: string; count: string; fail_count: string }[] = await this.repo.query(
      `SELECT defect_type, COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE status = 'fail')::int AS fail_count
         FROM quality_data
        WHERE is_active = true AND defect_type IS NOT NULL AND defect_type <> '' ${qdOrg}
        GROUP BY defect_type
        ORDER BY COUNT(*) DESC
        LIMIT 8`,
      p,
    );

    return {
      inspections30d: {
        total: Number(mix?.total ?? 0),
        pass: Number(mix?.pass ?? 0),
        fail: Number(mix?.fail ?? 0),
        warning: Number(mix?.warning ?? 0),
      },
      pendingSignoffs: Number(pending?.n ?? 0),
      firstPassYield: {
        ratePct: inspectedNodes ? Math.round((passedFirst / inspectedNodes) * 1000) / 10 : null,
        passedFirst,
        inspectedNodes,
      },
      openNcrBySeverity,
      ncrAging: {
        under7: Number(aging?.under7 ?? 0),
        d7to30: Number(aging?.d7to30 ?? 0),
        over30: Number(aging?.over30 ?? 0),
      },
      avgCloseDays90d: closeStats?.avg_days != null ? Math.round(Number(closeStats.avg_days) * 10) / 10 : null,
      closed90d: Number(closeStats?.n ?? 0),
      topDefects: defects.map((d) => ({
        defectType: d.defect_type,
        count: Number(d.count),
        failCount: Number(d.fail_count),
      })),
    };
  }
}
