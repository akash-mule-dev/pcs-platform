import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Ncr, NcrStatus } from './entities/ncr.entity.js';
import { Capa, CapaStatus } from './entities/capa.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { CreateNcrDto, UpdateNcrDto } from './dto/ncr.dto.js';
import { CreateCapaDto, UpdateCapaDto } from './dto/capa.dto.js';

@Injectable()
export class QualityNcrService {
  constructor(
    @InjectRepository(Ncr) private readonly ncrRepo: Repository<Ncr>,
    @InjectRepository(Capa) private readonly capaRepo: Repository<Capa>,
  ) {}

  private get org(): string { return TenantContext.requireOrganizationId(); }
  private get userId(): string | null { return TenantContext.get()?.userId ?? null; }

  // ---- NCR ----
  async createNcr(dto: CreateNcrDto): Promise<Ncr> {
    // Number from the MAX existing suffix (count() drifts after deletes), with a unique-race retry.
    const year = new Date().getFullYear();
    const prefix = `NCR-${year}-`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const rows: { num: string }[] = await this.ncrRepo.query(
        `SELECT number AS num FROM ncrs WHERE number LIKE $1 ORDER BY number DESC LIMIT 1`,
        [`${prefix}%`],
      );
      const base = rows?.[0]?.num ? parseInt(rows[0].num.slice(prefix.length), 10) || 0 : 0;
      const number = `${prefix}${String(base + 1).padStart(4, '0')}`;
      try {
        const ncr = this.ncrRepo.create({ ...(dto as any), number, organizationId: this.org, raisedBy: this.userId });
        return await this.ncrRepo.save(ncr as any);
      } catch (e: any) {
        if (e?.code === '23505') continue;
        throw e;
      }
    }
    throw new BadRequestException('Could not allocate a unique NCR number');
  }

  /** NCRs enriched with project name + item mark so the list reads in shop terms. */
  async listNcr(status?: string): Promise<(Ncr & { projectName?: string | null; itemMark?: string | null })[]> {
    const where: any = { organizationId: this.org };
    if (status) where.status = status;
    const rows = await this.ncrRepo.find({ where, order: { createdAt: 'DESC' } as any });

    const projectIds = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))];
    const nodeIds = [...new Set(rows.map((r) => r.assemblyNodeId).filter((x): x is string => !!x))];
    const projects: { id: string; name: string }[] = projectIds.length
      ? await this.ncrRepo.query(`SELECT id, name FROM projects WHERE id = ANY($1)`, [projectIds])
      : [];
    const nodes: { id: string; mark: string | null; name: string | null }[] = nodeIds.length
      ? await this.ncrRepo.query(`SELECT id, mark, name FROM assembly_nodes WHERE id = ANY($1)`, [nodeIds])
      : [];
    const pById = new Map(projects.map((p) => [p.id, p.name]));
    const nById = new Map(nodes.map((n) => [n.id, n.mark || n.name || null]));
    return rows.map((r) => ({
      ...r,
      projectName: r.projectId ? pById.get(r.projectId) ?? null : null,
      itemMark: r.assemblyNodeId ? nById.get(r.assemblyNodeId) ?? null : null,
    }));
  }
  async getNcr(id: string): Promise<Ncr> {
    const n = await this.ncrRepo.findOne({ where: { id, organizationId: this.org } as any });
    if (!n) throw new NotFoundException('NCR not found');
    return n;
  }
  async updateNcr(id: string, dto: UpdateNcrDto): Promise<Ncr> {
    const n = await this.getNcr(id);
    Object.assign(n, dto);
    if (dto.status === NcrStatus.CLOSED && !n.closedAt) n.closedAt = new Date();
    return this.ncrRepo.save(n);
  }

  // ---- CAPA ----
  createCapa(dto: CreateCapaDto): Promise<Capa> {
    return this.capaRepo.save(this.capaRepo.create({ ...(dto as any), organizationId: this.org }) as any);
  }
  listCapa(ncrId?: string): Promise<Capa[]> {
    const where: any = { organizationId: this.org };
    if (ncrId) where.ncrId = ncrId;
    return this.capaRepo.find({ where, order: { createdAt: 'DESC' } as any });
  }
  async updateCapa(id: string, dto: UpdateCapaDto): Promise<Capa> {
    const c = await this.capaRepo.findOne({ where: { id, organizationId: this.org } as any });
    if (!c) throw new NotFoundException('CAPA not found');
    Object.assign(c, dto);
    if (dto.status === CapaStatus.CLOSED && !c.closedAt) c.closedAt = new Date();
    return this.capaRepo.save(c);
  }
}
