import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

/**
 * Earned value / progress billing: weekly produced + shipped tonnage - the
 * numbers progress billing runs on - scoped to released production orders.
 * (BOM / material requirements live in material-requirements.service.ts.)
 */
@Injectable()
export class ProjectInsightsService {
  constructor(
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
  ) {}

  private async assertProject(projectId: string, org: string): Promise<Project> {
    const p = await this.projectRepo.findOne({ where: { id: projectId, organizationId: org } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  // ── Earned value / progress billing ─────────────────────────────────────

  async earnedValue(projectId: string, orderId?: string) {
    const org = TenantContext.requireOrganizationId();
    await this.assertProject(projectId, org);

    const orderFilter = orderId ? `AND w.production_order_id = $3` : '';
    const params: any[] = orderId ? [org, projectId, orderId] : [org, projectId];

    // Scope: released production (every non-cancelled per-assembly WO × its qty).
    const scope: any[] = await this.nodeRepo.query(
      `SELECT COALESCE(SUM(COALESCE(n.weight_kg, 0) * w.quantity), 0) AS kg,
              COUNT(w.id)::int AS pieces
         FROM work_orders w JOIN assembly_nodes n ON n.id = w.assembly_node_id
        WHERE w.organization_id = $1 AND n.project_id = $2 AND w.status <> 'cancelled' ${orderFilter}`,
      params,
    );

    // Produced: WOs whose every stage finished (status completed), by completion week.
    const produced: any[] = await this.nodeRepo.query(
      `SELECT date_trunc('week', w.completed_at) AS wk,
              SUM(COALESCE(n.weight_kg, 0) * w.quantity) AS kg,
              COUNT(w.id)::int AS pieces
         FROM work_orders w JOIN assembly_nodes n ON n.id = w.assembly_node_id
        WHERE w.organization_id = $1 AND n.project_id = $2 AND w.status = 'completed'
          AND w.completed_at IS NOT NULL ${orderFilter}
        GROUP BY 1 ORDER BY 1`,
      params,
    );

    // Shipped: items on shipped/delivered loads, by ship week (project-wide).
    const shipped: any[] = await this.nodeRepo.query(
      `SELECT date_trunc('week', COALESCE(sh.shipped_at, sh.planned_date)) AS wk,
              SUM(si.quantity * COALESCE(n.weight_kg, 0)) AS kg,
              SUM(si.quantity)::int AS pieces
         FROM shipment_items si
         JOIN shipments sh ON sh.id = si.shipment_id
         JOIN assembly_nodes n ON n.id = si.assembly_node_id
        WHERE si.organization_id = $1 AND sh.project_id = $2 AND sh.status IN ('shipped','delivered')
        GROUP BY 1 ORDER BY 1`,
      [org, projectId],
    );

    // Design tonnage (the whole tree, independent of orders).
    const design: any[] = await this.nodeRepo.query(
      `SELECT COALESCE(SUM(COALESCE(weight_kg, 0) * quantity), 0) AS kg
         FROM assembly_nodes WHERE organization_id = $1 AND project_id = $2 AND node_type = 'part'`,
      [org, projectId],
    );

    // Merge weekly buckets.
    const weeks = new Map<string, { weekStart: string; producedKg: number; producedPieces: number; shippedKg: number; shippedPieces: number }>();
    const bucket = (wk: any) => {
      const key = new Date(wk).toISOString().slice(0, 10);
      if (!weeks.has(key)) weeks.set(key, { weekStart: key, producedKg: 0, producedPieces: 0, shippedKg: 0, shippedPieces: 0 });
      return weeks.get(key)!;
    };
    for (const r of produced) { const b = bucket(r.wk); b.producedKg += Number(r.kg); b.producedPieces += Number(r.pieces); }
    for (const r of shipped) { const b = bucket(r.wk); b.shippedKg += Number(r.kg); b.shippedPieces += Number(r.pieces); }
    const series = [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    let cp = 0; let cs = 0;
    for (const w of series) {
      w.producedKg = Math.round(w.producedKg * 10) / 10;
      w.shippedKg = Math.round(w.shippedKg * 10) / 10;
      cp += w.producedKg; cs += w.shippedKg;
      (w as any).cumulativeProducedKg = Math.round(cp * 10) / 10;
      (w as any).cumulativeShippedKg = Math.round(cs * 10) / 10;
    }

    const scopeKg = Math.round(Number(scope[0]?.kg ?? 0) * 10) / 10;
    const producedKg = Math.round(produced.reduce((a, r) => a + Number(r.kg), 0) * 10) / 10;
    const shippedKg = Math.round(shipped.reduce((a, r) => a + Number(r.kg), 0) * 10) / 10;
    return {
      kpis: {
        designKg: Math.round(Number(design[0]?.kg ?? 0) * 10) / 10,
        scopeKg,
        scopePieces: Number(scope[0]?.pieces ?? 0),
        producedKg,
        shippedKg,
        producedPct: scopeKg > 0 ? Math.round((producedKg / scopeKg) * 1000) / 10 : 0,
        shippedPct: scopeKg > 0 ? Math.round((shippedKg / scopeKg) * 1000) / 10 : 0,
      },
      series,
    };
  }
}
