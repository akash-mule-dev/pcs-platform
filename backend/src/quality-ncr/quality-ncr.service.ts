import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    const year = new Date().getFullYear();
    const count = await this.ncrRepo.count({ where: { organizationId: this.org } as any });
    const number = `NCR-${year}-${String(count + 1).padStart(4, '0')}`;
    const ncr = this.ncrRepo.create({ ...(dto as any), number, organizationId: this.org, raisedBy: this.userId });
    return this.ncrRepo.save(ncr as any);
  }
  listNcr(status?: string): Promise<Ncr[]> {
    const where: any = { organizationId: this.org };
    if (status) where.status = status;
    return this.ncrRepo.find({ where, order: { createdAt: 'DESC' } as any });
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
