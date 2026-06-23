import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Shipment, ShipmentStatus } from './shipment.entity.js';
import { ShipmentItem } from './shipment-item.entity.js';
import { AssemblyNode } from '../projects/assembly-node.entity.js';
import { ProductionOrder } from '../projects/production-order.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage, WorkOrderStageStatus } from '../work-orders/work-order-stage.entity.js';
import { QualityReport } from '../quality-reports/quality-report.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { AddShipmentItemDto } from './dto/add-shipment-item.dto.js';
import { CreateShipmentDto } from './dto/create-shipment.dto.js';

/** A production-complete assembly of one work order, with its ship allocation. */
export interface ShipReadyRow {
  nodeId: string;
  mark: string | null;
  name: string | null;
  profile: string | null;
  weightKg: number | null;
  completedQty: number;
  shippedQty: number;
  allocatedQty: number;
  availableQty: number;
  openNcr: number;
  blocked: boolean;
}

@Injectable()
export class ShippingService extends TenantScopedService<Shipment> {
  constructor(
    @InjectRepository(Shipment) repo: Repository<Shipment>,
    @InjectRepository(ShipmentItem) private readonly itemRepo: Repository<ShipmentItem>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(ProductionOrder) private readonly orderRepo: Repository<ProductionOrder>,
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private readonly wosRepo: Repository<WorkOrderStage>,
    @InjectRepository(QualityReport) private readonly reportRepo: Repository<QualityReport>,
  ) {
    super(repo);
  }

  /**
   * Create a load for ONE work order (production order). The project is derived
   * from the order — shipping belongs to the work order, never the project.
   */
  async create(dto: CreateShipmentDto): Promise<Shipment> {
    const organizationId = TenantContext.requireOrganizationId();
    const order = await this.orderRepo.findOne({ where: { id: dto.productionOrderId, organizationId } });
    if (!order) throw new NotFoundException('Work order not found');
    const entity = this.repo.create({
      ...(dto as any),
      productionOrderId: order.id,
      projectId: order.projectId,
      organizationId,
    });
    return this.repo.save(entity as any);
  }

  /** Loads for one work order (production order). */
  async findByOrder(productionOrderId: string): Promise<Shipment[]> {
    return this.repo.find({
      where: { productionOrderId, organizationId: TenantContext.requireOrganizationId() },
      relations: ['items', 'items.assemblyNode'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByProject(projectId: string): Promise<Shipment[]> {
    return this.repo.find({
      where: { projectId, organizationId: TenantContext.requireOrganizationId() },
      relations: ['items', 'items.assemblyNode'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Units of an assembly that have finished production. Scoped to ONE work order
   * (production order) when `productionOrderId` is given — the count engine then
   * reflects only that run — else summed across all the node's work orders
   * (legacy/unscoped loads). A unit counts as complete once it has been through
   * every non-skipped stage; for status-only stage rows a fully completed work
   * order counts as its quantity.
   */
  private async completedUnits(nodeId: string, organizationId: string, productionOrderId?: string | null): Promise<number> {
    const where: any = { organizationId, assemblyNodeId: nodeId };
    if (productionOrderId) where.productionOrderId = productionOrderId;
    const wos = await this.woRepo.find({ where });
    if (!wos.length) return 0;
    const rows = await this.wosRepo.find({ where: { workOrderId: In(wos.map((w) => w.id)) } });
    const byWo = new Map<string, WorkOrderStage[]>();
    for (const r of rows) { const a = byWo.get(r.workOrderId) ?? []; a.push(r); byWo.set(r.workOrderId, a); }

    let units = 0;
    for (const wo of wos) {
      const active = (byWo.get(wo.id) ?? []).filter((r) => r.status !== WorkOrderStageStatus.SKIPPED);
      if (!active.length) continue;
      const allDone = active.every((r) => r.status === WorkOrderStageStatus.COMPLETED);
      const minDone = Math.min(...active.map((r) => Math.max(0, Math.min(r.qtyDone ?? 0, r.qtyTotal ?? 0))));
      units += allDone ? Math.max(minDone, wo.quantity ?? 1) : minDone;
    }
    return units;
  }

  /** Units of this assembly already on shipped/delivered loads (of one order when scoped). */
  private async shippedUnits(nodeId: string, organizationId: string, productionOrderId?: string | null): Promise<number> {
    const qb = this.itemRepo
      .createQueryBuilder('it')
      .innerJoin(Shipment, 's', 's.id = it.shipment_id')
      .where('it.assembly_node_id = :nodeId', { nodeId })
      .andWhere('it.organization_id = :org', { org: organizationId })
      .andWhere('s.status IN (:...done)', { done: [ShipmentStatus.SHIPPED, ShipmentStatus.DELIVERED] });
    if (productionOrderId) qb.andWhere('s.production_order_id = :poid', { poid: productionOrderId });
    const row = await qb.select('COALESCE(SUM(it.quantity), 0)', 'sum').getRawOne<{ sum: string }>();
    return Number(row?.sum ?? 0);
  }

  /**
   * Add an assembly to a load — GATED: within THIS load's work order it must have
   * production-complete units left to ship (its stages done), no open NCRs, and
   * not already be fully allocated to that order's other loads.
   */
  async addItem(shipmentId: string, dto: AddShipmentItemDto): Promise<ShipmentItem> {
    const organizationId = TenantContext.requireOrganizationId();
    const shipment = await this.findOne(shipmentId); // tenant check
    const orderId = shipment.productionOrderId;

    const node = await this.nodeRepo.findOne({ where: { id: dto.assemblyNodeId, organizationId } });
    if (!node) throw new NotFoundException('Assembly not found');
    const label = node.mark || node.name || 'Assembly';
    if (node.projectId !== shipment.projectId) {
      throw new BadRequestException(`${label} belongs to a different project than this load`);
    }

    const completed = await this.completedUnits(node.id, organizationId, orderId);
    if (completed <= 0) {
      throw new BadRequestException(`${label} cannot be shipped: its production stages are not complete yet.`);
    }

    const openNcr = await this.reportRepo.count({
      where: { assemblyNodeId: node.id, organizationId, templateType: 'ncr', resolvedAt: IsNull() },
    });
    if (openNcr > 0) {
      const plural = openNcr === 1 ? '' : 's';
      throw new BadRequestException(`${label} has ${openNcr} open NCR report${plural} — resolve before shipping.`);
    }

    // Quantity guard: shipped so far + already planned on this order's open loads + this add ≤ completed units.
    const plannedQb = this.itemRepo
      .createQueryBuilder('it')
      .innerJoin(Shipment, 's', 's.id = it.shipment_id')
      .where('it.assembly_node_id = :nodeId', { nodeId: node.id })
      .andWhere('it.organization_id = :org', { org: organizationId })
      .andWhere('s.status NOT IN (:...closed)', { closed: [ShipmentStatus.SHIPPED, ShipmentStatus.DELIVERED, ShipmentStatus.CANCELLED] });
    if (orderId) plannedQb.andWhere('s.production_order_id = :poid', { poid: orderId });
    const planned = await plannedQb.select('COALESCE(SUM(it.quantity), 0)', 'sum').getRawOne<{ sum: string }>();
    const alreadyPlanned = Number(planned?.sum ?? 0);
    const shipped = await this.shippedUnits(node.id, organizationId, orderId);
    const remaining = completed - shipped - alreadyPlanned;
    const qty = dto.quantity ?? 1;
    if (qty > remaining) {
      throw new BadRequestException(
        remaining <= 0
          ? `${label} is already fully shipped or allocated to loads.`
          : `Only ${remaining} unit(s) of ${label} left to ship — requested ${qty}.`,
      );
    }

    const item = this.itemRepo.create({
      shipmentId,
      assemblyNodeId: dto.assemblyNodeId,
      quantity: qty,
      organizationId,
    });
    return this.itemRepo.save(item);
  }

  async removeItem(shipmentId: string, itemId: string): Promise<void> {
    await this.findOne(shipmentId); // tenant check
    await this.itemRepo.delete({ id: itemId, shipmentId, organizationId: TenantContext.requireOrganizationId() });
  }

  /**
   * Set a shipment's status. What's shipped is derived from the loads
   * themselves (items on shipped/delivered shipments) — nothing is written
   * back onto the assembly tree.
   */
  async setStatus(id: string, status: ShipmentStatus): Promise<Shipment> {
    const organizationId = TenantContext.requireOrganizationId();
    const shipment = await this.repo.findOne({ where: { id, organizationId } });
    if (!shipment) throw new NotFoundException('Shipment not found');

    shipment.status = status;
    if (status === ShipmentStatus.SHIPPED && !shipment.shippedAt) shipment.shippedAt = new Date();
    return this.repo.save(shipment);
  }

  /**
   * Everything a printable delivery note / packing slip needs in one call:
   * org + project header, load details, itemized assemblies (mark, profile,
   * grade, qty, unit + line weight) and totals. Optionally folds in the heat
   * numbers per item (incl. descendant parts) so the slip doubles as the MTR
   * cover sheet. The web renders this in a print-optimized view → browser PDF.
   */
  async deliveryNote(id: string, includeHeats = true) {
    const organizationId = TenantContext.requireOrganizationId();
    const shipment = await this.repo.findOne({
      where: { id, organizationId },
      relations: ['project', 'productionOrder', 'items', 'items.assemblyNode'],
    });
    if (!shipment) throw new NotFoundException('Shipment not found');

    const org: any[] = await this.itemRepo.query(
      `SELECT name, slug FROM organizations WHERE id = $1`,
      [organizationId],
    );

    // Heat numbers per shipped node, rolled up through descendant parts.
    const heatByNode = new Map<string, { heatNumber: string | null; lotNumber: string; certReference: string | null }[]>();
    if (includeHeats && shipment.items.length) {
      const tree: { id: string; parent_id: string | null }[] = await this.nodeRepo.query(
        `SELECT id, parent_id FROM assembly_nodes WHERE organization_id = $1 AND project_id = $2`,
        [organizationId, shipment.projectId],
      );
      const children = new Map<string, string[]>();
      for (const t of tree) {
        if (!t.parent_id) continue;
        const a = children.get(t.parent_id) ?? []; a.push(t.id); children.set(t.parent_id, a);
      }
      const descendants = (root: string): string[] => {
        const out = [root];
        for (let i = 0; i < out.length; i++) for (const c of children.get(out[i]) ?? []) out.push(c);
        return out;
      };
      const lots: any[] = await this.nodeRepo.query(
        `SELECT a.node_id, l.lot_number, l.heat_number, l.cert_reference
           FROM piece_lot_assignments a JOIN material_lots l ON l.id = a.material_lot_id
          WHERE a.organization_id = $1 AND a.project_id = $2`,
        [organizationId, shipment.projectId],
      );
      const lotsByNode = new Map<string, any[]>();
      for (const l of lots) { const a = lotsByNode.get(l.node_id) ?? []; a.push(l); lotsByNode.set(l.node_id, a); }
      for (const it of shipment.items) {
        const seen = new Set<string>();
        const acc: { heatNumber: string | null; lotNumber: string; certReference: string | null }[] = [];
        for (const nid of descendants(it.assemblyNodeId)) {
          for (const l of lotsByNode.get(nid) ?? []) {
            const k = `${l.lot_number}|${l.heat_number}`;
            if (seen.has(k)) continue; seen.add(k);
            acc.push({ heatNumber: l.heat_number, lotNumber: l.lot_number, certReference: l.cert_reference });
          }
        }
        if (acc.length) heatByNode.set(it.assemblyNodeId, acc);
      }
    }

    const items = shipment.items.map((it) => {
      const n = it.assemblyNode;
      const unitKg = n?.weightKg != null ? Number(n.weightKg) : null;
      return {
        mark: n?.mark ?? null,
        name: n?.name ?? null,
        nodeType: n?.nodeType ?? null,
        profile: n?.profile ?? null,
        materialGrade: n?.materialGrade ?? null,
        quantity: it.quantity,
        unitWeightKg: unitKg,
        lineWeightKg: unitKg != null ? Math.round(unitKg * it.quantity * 10) / 10 : null,
        heats: heatByNode.get(it.assemblyNodeId) ?? [],
      };
    });

    const totalPieces = items.reduce((a, it) => a + it.quantity, 0);
    const totalWeightKg = Math.round(items.reduce((a, it) => a + (it.lineWeightKg ?? 0), 0) * 10) / 10;

    return {
      organization: { name: org[0]?.name ?? 'Organization' },
      project: { id: shipment.projectId, name: shipment.project?.name ?? null, number: (shipment.project as any)?.projectNumber ?? null, client: (shipment.project as any)?.clientName ?? null },
      order: { id: shipment.productionOrderId, number: shipment.productionOrder?.number ?? null, customerName: shipment.productionOrder?.customerName ?? null },
      shipment: {
        id: shipment.id,
        number: shipment.shipmentNumber,
        status: shipment.status,
        destination: shipment.destination,
        carrier: shipment.carrier,
        plannedDate: shipment.plannedDate,
        shippedAt: shipment.shippedAt,
        notes: shipment.notes,
      },
      items,
      totals: { lines: items.length, pieces: totalPieces, weightKg: totalWeightKg },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * QC sign-off dossier (customer hand-off package) for a shipment: the delivery
   * note header + MTR rollup, plus every inspection record, NCR (with disposition)
   * and filled report for the SHIPPED nodes (descendant-aware), and a
   * releasability summary (open NCRs / unsigned failures / MTR coverage gaps).
   * Reuses the deliveryNote assembler; rendered to PDF via the web print view.
   */
  async qcPackage(id: string) {
    const organizationId = TenantContext.requireOrganizationId();
    const note = await this.deliveryNote(id, true); // header + items + heats (MTR), org-scoped + existence-checked
    const shipment = await this.repo.findOne({ where: { id, organizationId }, relations: ['items'] });
    if (!shipment) throw new NotFoundException('Shipment not found');

    // Shipped scope = each shipped item's node + all its descendants.
    const tree: { id: string; parent_id: string | null }[] = await this.nodeRepo.query(
      `SELECT id, parent_id FROM assembly_nodes WHERE organization_id = $1 AND project_id = $2`,
      [organizationId, shipment.projectId],
    );
    const children = new Map<string, string[]>();
    for (const t of tree) { if (t.parent_id) { const a = children.get(t.parent_id) ?? []; a.push(t.id); children.set(t.parent_id, a); } }
    const scope = new Set<string>();
    for (const it of shipment.items) {
      const stack = [it.assemblyNodeId];
      for (let i = 0; i < stack.length; i++) { scope.add(stack[i]); for (const c of children.get(stack[i]) ?? []) stack.push(c); }
    }
    const nodeIds = [...scope];

    const inspections = nodeIds.length ? await this.nodeRepo.query(
      `SELECT q.id, q.mesh_name, q.status, q.signoff_status, q.severity, q.defect_type,
              q.measurement_value, q.measurement_unit, q.tolerance_min, q.tolerance_max,
              q.inspector, q.created_at, n.mark AS node_mark
         FROM quality_data q LEFT JOIN assembly_nodes n ON n.id = q.assembly_node_id
        WHERE q.organization_id = $1 AND q.assembly_node_id = ANY($2) AND q.is_active = true
        ORDER BY q.created_at DESC`,
      [organizationId, nodeIds],
    ) : [];

    const reportRows = nodeIds.length ? await this.reportRepo.query(
      `SELECT r.id, r.number, r.template_name, r.template_type, r.status, r.ncr_status,
              r.disposition, r.disposition_notes, r.root_cause, r.corrective_action,
              r.concession_reason, r.resolved_at, r.created_at, n.mark AS node_mark
         FROM quality_reports r LEFT JOIN assembly_nodes n ON n.id = r.assembly_node_id
        WHERE r.organization_id = $1 AND r.assembly_node_id = ANY($2)
        ORDER BY r.created_at DESC`,
      [organizationId, nodeIds],
    ) : [];
    const ncrs = reportRows.filter((r: any) => r.template_type === 'ncr');
    const reports = reportRows.filter((r: any) => r.template_type !== 'ncr');

    // Releasability checks.
    const openNcrs = ncrs.filter((r: any) => r.resolved_at == null).length;
    const unsignedFailures = inspections.filter((q: any) => q.status === 'fail' && q.signoff_status !== 'approved').length;
    const itemsMissingMtr = note.items.filter((it: any) => !it.heats || it.heats.length === 0).length;

    return {
      ...note,
      qc: {
        inspections,
        ncrs,
        reports,
        scopeNodeCount: nodeIds.length,
        releasability: {
          openNcrs,
          unsignedFailures,
          itemsMissingMtr,
          releasable: openNcrs === 0 && unsignedFailures === 0,
        },
      },
    };
  }

  /**
   * Ship board for ONE work order (production order): every assembly this order
   * has fabricated to production-complete, with how many units are shipped,
   * already allocated to its open loads, and still available — plus an open-NCR
   * block flag. Mirrors the addItem gate exactly, scoped to the order, in a few
   * batch queries (never N+1). The web "Ready to ship" column reads this.
   */
  async shipBoard(productionOrderId: string): Promise<ShipReadyRow[]> {
    const org = TenantContext.requireOrganizationId();
    const order = await this.orderRepo.findOne({ where: { id: productionOrderId, organizationId: org } });
    if (!order) throw new NotFoundException('Work order not found');

    // Production-complete units per node, scoped to THIS order's work orders.
    const completedRows: { nid: string; units: string }[] = await this.repo.query(
      `SELECT nid, SUM(units)::int AS units FROM (
         SELECT w.assembly_node_id AS nid,
                CASE WHEN BOOL_AND(s.status = 'completed')
                     THEN GREATEST(MIN(LEAST(s.qty_done, COALESCE(s.qty_total, 0))), w.quantity)
                     ELSE COALESCE(MIN(LEAST(s.qty_done, COALESCE(s.qty_total, 0))), 0) END AS units
           FROM work_orders w
           JOIN work_order_stages s ON s.work_order_id = w.id AND s.status <> 'skipped'
          WHERE w.organization_id = $1 AND w.production_order_id = $2
          GROUP BY w.id, w.assembly_node_id, w.quantity
       ) t GROUP BY nid`,
      [org, productionOrderId],
    );
    const completedBy = new Map(completedRows.map((r) => [r.nid, Number(r.units)]));
    const ids = [...completedBy.keys()].filter((nid) => (completedBy.get(nid) ?? 0) > 0);
    if (!ids.length) return [];

    const shippedRows: { nid: string; qty: string }[] = await this.repo.query(
      `SELECT it.assembly_node_id AS nid, COALESCE(SUM(it.quantity), 0)::int AS qty
         FROM shipment_items it JOIN shipments sh ON sh.id = it.shipment_id
        WHERE it.organization_id = $1 AND sh.production_order_id = $2 AND it.assembly_node_id = ANY($3)
          AND sh.status IN ('shipped','delivered')
        GROUP BY it.assembly_node_id`,
      [org, productionOrderId, ids],
    );
    const plannedRows: { nid: string; qty: string }[] = await this.repo.query(
      `SELECT it.assembly_node_id AS nid, COALESCE(SUM(it.quantity), 0)::int AS qty
         FROM shipment_items it JOIN shipments sh ON sh.id = it.shipment_id
        WHERE it.organization_id = $1 AND sh.production_order_id = $2 AND it.assembly_node_id = ANY($3)
          AND sh.status NOT IN ('shipped','delivered','cancelled')
        GROUP BY it.assembly_node_id`,
      [org, productionOrderId, ids],
    );
    const ncrRows: { nid: string; cnt: string }[] = await this.repo.query(
      `SELECT assembly_node_id AS nid, COUNT(*)::int AS cnt FROM quality_reports
        WHERE organization_id = $1 AND assembly_node_id = ANY($2) AND template_type = 'ncr' AND resolved_at IS NULL
        GROUP BY assembly_node_id`,
      [org, ids],
    );
    const nodes = await this.nodeRepo.find({ where: { id: In(ids), organizationId: org } });

    const shippedBy = new Map(shippedRows.map((r) => [r.nid, Number(r.qty)]));
    const plannedBy = new Map(plannedRows.map((r) => [r.nid, Number(r.qty)]));
    const ncrBy = new Map(ncrRows.map((r) => [r.nid, Number(r.cnt)]));

    const rows: ShipReadyRow[] = nodes.map((n) => {
      const completedQty = completedBy.get(n.id) ?? 0;
      const shippedQty = shippedBy.get(n.id) ?? 0;
      const allocatedQty = plannedBy.get(n.id) ?? 0;
      const openNcr = ncrBy.get(n.id) ?? 0;
      return {
        nodeId: n.id,
        mark: n.mark ?? null,
        name: n.name ?? null,
        profile: n.profile ?? null,
        weightKg: n.weightKg != null ? Number(n.weightKg) : null,
        completedQty,
        shippedQty,
        allocatedQty,
        availableQty: Math.max(0, completedQty - shippedQty - allocatedQty),
        openNcr,
        blocked: openNcr > 0,
      };
    });
    rows.sort((a, b) => (a.mark || a.name || '').localeCompare(b.mark || b.name || ''));
    return rows;
  }
}
