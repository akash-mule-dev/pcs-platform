import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode, AssemblyNodeType } from './assembly-node.entity.js';
import { ProductionOrder } from './production-order.entity.js';
import { Material, MaterialType } from '../materials/entities/material.entity.js';
import { MaterialStock } from '../materials/entities/material-stock.entity.js';
import { StockMovement } from '../materials/entities/stock-movement.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import {
  aggregateRequirements, scaleRequirements, requirementKey, requiredQtyInUom, coverage,
  RequirementLine,
} from './material-requirements-math.js';

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;

export interface MatchedMaterial {
  id: string;
  code: string;
  name: string;
  unitOfMeasure: string;
  unitCost: number;
  onHand: number;
  lowStock: boolean;
}

/**
 * Raw-material planning for fabrication:
 *  - PROJECT requirements — what one unit of the design needs, aggregated from
 *    the assembly tree's part nodes by (profile, grade);
 *  - ORDER requirements — the same lines × the order quantity, with what's
 *    already been issued from stock and whether on-hand covers the rest;
 *  - material-master sync — create missing masters for unmapped lines so the
 *    warehouse can price + stock them.
 *
 * Cross-module reads go through entity repositories only (no module imports) —
 * the same acyclic pattern shipping uses.
 */
@Injectable()
export class MaterialRequirementsService {
  constructor(
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(ProductionOrder) private readonly orderRepo: Repository<ProductionOrder>,
    @InjectRepository(Material) private readonly materialRepo: Repository<Material>,
    @InjectRepository(MaterialStock) private readonly stockRepo: Repository<MaterialStock>,
    @InjectRepository(StockMovement) private readonly moveRepo: Repository<StockMovement>,
  ) {}

  private get org(): string { return TenantContext.requireOrganizationId(); }

  // ── Building blocks ────────────────────────────────────────────────────────

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.projectRepo.findOne({ where: { id: projectId, organizationId: this.org } as any });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /** Per-unit requirement lines straight from the design tree's parts. */
  private async perUnitLines(projectId: string): Promise<RequirementLine[]> {
    const parts = await this.nodeRepo.find({
      where: { projectId, organizationId: this.org, nodeType: AssemblyNodeType.PART } as any,
      select: ['id', 'profile', 'materialGrade', 'lengthMm', 'weightKg', 'quantity'] as any,
    });
    return aggregateRequirements(parts.map((p) => ({
      profile: p.profile, materialGrade: p.materialGrade,
      lengthMm: p.lengthMm, weightKg: p.weightKg, quantity: p.quantity ?? 1,
    })));
  }

  /** Org materials keyed by normalized (profile|grade), with aggregated on-hand stock. */
  private async materialIndex(): Promise<Map<string, MatchedMaterial>> {
    const org = this.org;
    const materials = await this.materialRepo.find({ where: { organizationId: org, isActive: true } as any, order: { code: 'ASC' } });
    const stock = await this.stockRepo.find({ where: { organizationId: org } as any });
    const onHand = new Map<string, number>();
    for (const s of stock) onHand.set(s.materialId, (onHand.get(s.materialId) ?? 0) + (Number(s.quantityOnHand) || 0));

    const index = new Map<string, MatchedMaterial>();
    for (const m of materials) {
      if (!m.profile && !m.materialGrade) continue; // not a BOM-matchable master
      const key = requirementKey(m.profile, m.materialGrade);
      if (index.has(key)) continue; // first by code wins; duplicates are a data-entry issue
      const oh = round3(onHand.get(m.id) ?? 0);
      index.set(key, {
        id: m.id, code: m.code, name: m.name, unitOfMeasure: m.unitOfMeasure,
        unitCost: Number(m.unitCost) || 0, onHand: oh,
        lowStock: (Number(m.reorderLevel) || 0) > 0 && oh <= (Number(m.reorderLevel) || 0),
      });
    }
    return index;
  }

  private decorateLine(line: RequirementLine, index: Map<string, MatchedMaterial>) {
    const material = index.get(line.key) ?? null;
    const uom = material?.unitOfMeasure ?? 'kg';
    const known = /^(kg|m|meter|metre|mtr|mm|ea|pcs|pc|piece|pieces|each|t|ton|tonne)$/i.test(uom.trim());
    const requiredQty = requiredQtyInUom(line, uom);
    return {
      key: line.key,
      profile: line.profile,
      materialGrade: line.materialGrade,
      pieceCount: line.pieceCount,
      totalLengthMm: line.totalLengthMm,
      totalWeightKg: line.totalWeightKg,
      material,
      uom: material ? uom : 'kg',
      uomAssumed: !!material && !known, // unrecognized unit — we fell back to kg
      requiredQty,
      estimatedCost: material ? round2(requiredQty * material.unitCost) : null,
    };
  }

  // ── Project (per design unit) ──────────────────────────────────────────────

  /** What ONE unit of this project's design needs, with stock match + estimated cost. */
  async projectRequirements(projectId: string) {
    await this.requireProject(projectId);
    const [lines, index] = await Promise.all([this.perUnitLines(projectId), this.materialIndex()]);
    const decorated = lines.map((l) => this.decorateLine(l, index));
    const mapped = decorated.filter((l) => l.material);
    return {
      projectId,
      perUnit: true,
      lines: decorated,
      totals: {
        lines: decorated.length,
        pieces: decorated.reduce((s, l) => s + l.pieceCount, 0),
        weightKg: round3(decorated.reduce((s, l) => s + l.totalWeightKg, 0)),
        estimatedCost: round2(mapped.reduce((s, l) => s + (l.estimatedCost ?? 0), 0)),
        unmappedLines: decorated.length - mapped.length,
        unpricedLines: mapped.filter((l) => (l.material?.unitCost ?? 0) <= 0).length,
      },
    };
  }

  /** Create material masters for unmapped requirement lines (code from profile+grade). */
  async syncMaterials(projectId: string) {
    const org = this.org;
    await this.requireProject(projectId);
    const [lines, index] = await Promise.all([this.perUnitLines(projectId), this.materialIndex()]);
    const missing = lines.filter((l) => !index.has(l.key) && (l.profile || l.materialGrade));

    const existingCodes = new Set(
      (await this.materialRepo.find({ where: { organizationId: org } as any, select: ['code'] as any })).map((m) => m.code.toUpperCase()),
    );
    const created: { id: string; code: string; name: string }[] = [];
    for (const line of missing) {
      const baseCode = [line.profile, line.materialGrade].filter(Boolean).join('-')
        .replace(/\s+/g, '').replace(/[^A-Za-z0-9.\-/]/g, '').toUpperCase().slice(0, 90) || 'MATERIAL';
      let code = baseCode;
      for (let i = 2; existingCodes.has(code); i++) code = `${baseCode}-${i}`;
      existingCodes.add(code);
      const saved = await this.materialRepo.save(this.materialRepo.create({
        organizationId: org,
        code,
        name: [line.profile, line.materialGrade].filter(Boolean).join(' ') || 'Imported material',
        type: this.guessType(line.profile),
        unitOfMeasure: 'kg',
        specification: line.materialGrade,
        profile: line.profile,
        materialGrade: line.materialGrade,
        unitCost: 0,
        reorderLevel: 0,
        isActive: true,
      } as any));
      created.push({ id: (saved as any).id, code: (saved as any).code, name: (saved as any).name });
    }
    return { created, skipped: lines.length - missing.length };
  }

  private guessType(profile: string | null): MaterialType {
    const p = (profile ?? '').toUpperCase();
    if (!p) return MaterialType.OTHER;
    if (p.startsWith('PL') || p.startsWith('FL') || p.startsWith('PLT')) return MaterialType.PLATE;
    if (p.startsWith('RHS') || p.startsWith('SHS') || p.startsWith('CHS') || p.startsWith('PIPE') || p.startsWith('TUBE')) return MaterialType.TUBE;
    return MaterialType.BAR; // rolled sections: UC/UB/HEA/HEB/IPE/L/C/W…
  }

  // ── Production order (per-unit × order quantity) ───────────────────────────

  /**
   * The order's scaled requirement with live fulfillment: issued so far (net of
   * returns), remaining, and whether current stock covers the rest. Materials
   * issued to the order OUTSIDE the BOM (consumables, extras) are listed too —
   * they're real consumption and the costing engine counts them.
   */
  async orderRequirements(orderId: string) {
    const org = this.org;
    const order = await this.orderRepo.findOne({ where: { id: orderId, organizationId: org } as any });
    if (!order) throw new NotFoundException('Production order not found');

    const [unitLines, index] = await Promise.all([this.perUnitLines(order.projectId), this.materialIndex()]);
    const scaled = scaleRequirements(unitLines, order.quantity ?? 1);
    const decorated = scaled.map((l) => this.decorateLine(l, index));

    // Net issued per material for this order (issues + scrap − returns), qty + cost from stamped ledger rows.
    const issuedRows: { material_id: string; qty: string; cost: string }[] = await this.moveRepo.query(
      `SELECT material_id,
              COALESCE(SUM(CASE WHEN type IN ('issue','scrap') THEN quantity
                                WHEN type = 'return' THEN -quantity ELSE 0 END), 0) AS qty,
              COALESCE(SUM(CASE WHEN type IN ('issue','scrap') THEN quantity * COALESCE(unit_cost, 0)
                                WHEN type = 'return' THEN -quantity * COALESCE(unit_cost, 0) ELSE 0 END), 0) AS cost
         FROM stock_movements
        WHERE organization_id = $1 AND production_order_id = $2
        GROUP BY material_id`,
      [org, orderId],
    );
    const issuedByMaterial = new Map(issuedRows.map((r) => [r.material_id, { qty: Math.max(0, Number(r.qty) || 0), cost: Math.max(0, Number(r.cost) || 0) }]));

    const consumedMaterialIds = new Set<string>();
    const lines = decorated.map((l) => {
      const issued = l.material ? issuedByMaterial.get(l.material.id) : undefined;
      if (l.material) consumedMaterialIds.add(l.material.id);
      const cov = coverage(l.requiredQty, issued?.qty ?? 0, l.material?.onHand ?? null, !!l.material);
      return {
        ...l,
        issuedQty: round3(issued?.qty ?? 0),
        issuedCost: round2(issued?.cost ?? 0),
        remainingQty: cov.remainingQty,
        shortfallQty: cov.shortfallQty,
        status: cov.status,
      };
    });

    // Off-BOM consumption (issued to this order but matching no requirement line).
    const extraIds = [...issuedByMaterial.keys()].filter((id) => !consumedMaterialIds.has(id));
    const extraMaterials = extraIds.length
      ? await this.materialRepo.find({ where: extraIds.map((id) => ({ id, organizationId: org })) as any })
      : [];
    const extras = extraMaterials.map((m) => {
      const issued = issuedByMaterial.get(m.id)!;
      return {
        material: { id: m.id, code: m.code, name: m.name, unitOfMeasure: m.unitOfMeasure, unitCost: Number(m.unitCost) || 0 },
        issuedQty: round3(issued.qty),
        issuedCost: round2(issued.cost),
      };
    }).filter((e) => e.issuedQty > 0 || e.issuedCost > 0);

    const mapped = lines.filter((l) => l.material);
    const totalEstimated = round2(mapped.reduce((s, l) => s + (l.estimatedCost ?? 0), 0));
    const totalIssuedCost = round2(lines.reduce((s, l) => s + l.issuedCost, 0) + extras.reduce((s, e) => s + e.issuedCost, 0));
    return {
      orderId,
      orderNumber: order.number,
      orderQuantity: order.quantity,
      orderStatus: String(order.status),
      projectId: order.projectId,
      lines,
      extras,
      totals: {
        lines: lines.length,
        pieces: lines.reduce((s, l) => s + l.pieceCount, 0),
        weightKg: round3(lines.reduce((s, l) => s + l.totalWeightKg, 0)),
        estimatedCost: totalEstimated,
        issuedCost: totalIssuedCost,
        unmappedLines: lines.length - mapped.length,
        shortLines: lines.filter((l) => l.status === 'short').length,
        fullyIssuedLines: lines.filter((l) => l.status === 'issued').length,
      },
    };
  }
}
