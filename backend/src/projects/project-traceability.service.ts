import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PieceLotAssignment } from './piece-lot-assignment.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

/**
 * Piece-level material traceability: assign material lots (heat # + mill cert)
 * to assembly nodes, and roll the chain up per shipment — the MTR package an
 * AISC/EN 1090 job must hand over with every load.
 */
@Injectable()
export class ProjectTraceabilityService {
  constructor(
    @InjectRepository(PieceLotAssignment) private readonly lotRepo: Repository<PieceLotAssignment>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
  ) {}

  private async assertNode(projectId: string, nodeId: string, org: string): Promise<AssemblyNode> {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, projectId, organizationId: org } });
    if (!node) throw new NotFoundException('Assembly node not found');
    return node;
  }

  /** Lots available to pick from (org's receiving records, newest first). */
  async availableLots(q?: string) {
    const org = TenantContext.requireOrganizationId();
    const params: any[] = [org];
    let where = `l.organization_id = $1`;
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (l.lot_number ILIKE $2 OR l.heat_number ILIKE $2 OR l.supplier ILIKE $2 OR m.code ILIKE $2 OR m.name ILIKE $2)`;
    }
    return this.lotRepo.query(
      `SELECT l.id, l.lot_number, l.heat_number, l.supplier, l.cert_reference,
              l.remaining_quantity, m.code AS material_code, m.name AS material_name
         FROM material_lots l
         LEFT JOIN materials m ON m.id = l.material_id
        WHERE ${where}
        ORDER BY l.created_at DESC
        LIMIT 50`,
      params,
    );
  }

  async listForNode(projectId: string, nodeId: string) {
    const org = TenantContext.requireOrganizationId();
    await this.assertNode(projectId, nodeId, org);
    return this.lotRepo.query(
      `SELECT a.id, a.quantity, a.note, a.created_by_name, a.created_at,
              l.id AS lot_id, l.lot_number, l.heat_number, l.supplier, l.cert_reference,
              m.code AS material_code, m.name AS material_name
         FROM piece_lot_assignments a
         JOIN material_lots l ON l.id = a.material_lot_id
         LEFT JOIN materials m ON m.id = l.material_id
        WHERE a.organization_id = $1 AND a.node_id = $2
        ORDER BY a.created_at DESC`,
      [org, nodeId],
    );
  }

  async assign(
    projectId: string,
    nodeId: string,
    body: { materialLotId: string; quantity?: number; note?: string },
    user?: { id?: string; email?: string; firstName?: string; lastName?: string },
  ): Promise<PieceLotAssignment> {
    const org = TenantContext.requireOrganizationId();
    await this.assertNode(projectId, nodeId, org);
    if (!body?.materialLotId) throw new BadRequestException('materialLotId is required');
    const lot = await this.lotRepo.query(
      `SELECT id FROM material_lots WHERE id = $1 AND organization_id = $2`,
      [body.materialLotId, org],
    );
    if (!lot.length) throw new NotFoundException('Material lot not found');

    const createdByName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || null;
    return this.lotRepo.save(this.lotRepo.create({
      organizationId: org,
      projectId,
      nodeId,
      materialLotId: body.materialLotId,
      quantity: body.quantity ?? 1,
      note: body.note?.trim() || null,
      createdById: user?.id ?? null,
      createdByName,
    }));
  }

  async unassign(projectId: string, assignmentId: string): Promise<{ ok: true }> {
    const org = TenantContext.requireOrganizationId();
    const row = await this.lotRepo.findOne({ where: { id: assignmentId, projectId, organizationId: org } });
    if (!row) throw new NotFoundException('Assignment not found');
    await this.lotRepo.remove(row);
    return { ok: true };
  }

  /**
   * MTR rollup for a shipment: every item on the load with the heat numbers /
   * certs of itself AND its descendant parts. Items without any lot are
   * flagged — the gap list to close before the truck leaves.
   */
  async shipmentTraceability(projectId: string, shipmentId: string) {
    const org = TenantContext.requireOrganizationId();
    const shipment: any[] = await this.lotRepo.query(
      `SELECT id, shipment_number, status FROM shipments WHERE id = $1 AND project_id = $2 AND organization_id = $3`,
      [shipmentId, projectId, org],
    );
    if (!shipment.length) throw new NotFoundException('Shipment not found');

    const items: any[] = await this.lotRepo.query(
      `SELECT si.id AS item_id, si.quantity, n.id AS node_id, n.mark, n.name
         FROM shipment_items si JOIN assembly_nodes n ON n.id = si.assembly_node_id
        WHERE si.organization_id = $1 AND si.shipment_id = $2`,
      [org, shipmentId],
    );
    if (!items.length) return { shipment: shipment[0], items: [], summary: { items: 0, covered: 0, missing: 0 } };

    // Whole-tree parent map → descendants of each shipped node.
    const tree: { id: string; parent_id: string | null }[] = await this.lotRepo.query(
      `SELECT id, parent_id FROM assembly_nodes WHERE organization_id = $1 AND project_id = $2`,
      [org, projectId],
    );
    const children = new Map<string, string[]>();
    for (const t of tree) {
      if (!t.parent_id) continue;
      const arr = children.get(t.parent_id) ?? [];
      arr.push(t.id);
      children.set(t.parent_id, arr);
    }
    const descendants = (rootId: string): string[] => {
      const out: string[] = [rootId];
      for (let i = 0; i < out.length; i++) {
        for (const c of children.get(out[i]) ?? []) out.push(c);
      }
      return out;
    };

    const lots: any[] = await this.lotRepo.query(
      `SELECT a.node_id, l.lot_number, l.heat_number, l.supplier, l.cert_reference,
              m.code AS material_code, m.name AS material_name
         FROM piece_lot_assignments a
         JOIN material_lots l ON l.id = a.material_lot_id
         LEFT JOIN materials m ON m.id = l.material_id
        WHERE a.organization_id = $1 AND a.project_id = $2`,
      [org, projectId],
    );
    const lotsByNode = new Map<string, any[]>();
    for (const l of lots) {
      const arr = lotsByNode.get(l.node_id) ?? [];
      arr.push(l);
      lotsByNode.set(l.node_id, arr);
    }

    const rows = items.map((it) => {
      const seen = new Set<string>();
      const itemLots: any[] = [];
      for (const id of descendants(it.node_id)) {
        for (const l of lotsByNode.get(id) ?? []) {
          const key = `${l.lot_number}|${l.heat_number}`;
          if (seen.has(key)) continue;
          seen.add(key);
          itemLots.push({
            lotNumber: l.lot_number,
            heatNumber: l.heat_number,
            supplier: l.supplier,
            certReference: l.cert_reference,
            material: l.material_code ? `${l.material_code} — ${l.material_name}` : l.material_name,
          });
        }
      }
      return { itemId: it.item_id, mark: it.mark, name: it.name, quantity: Number(it.quantity), lots: itemLots, covered: itemLots.length > 0 };
    });

    return {
      shipment: shipment[0],
      items: rows,
      summary: { items: rows.length, covered: rows.filter((r) => r.covered).length, missing: rows.filter((r) => !r.covered).length },
    };
  }
}
