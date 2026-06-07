import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { MaterialLot } from './entities/material-lot.entity.js';
import { SerialUnit } from './entities/serial-unit.entity.js';
import { GenealogyLink } from './entities/genealogy-link.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { CreateMaterialLotDto, CreateSerialDto, UpdateSerialDto, LinkGenealogyDto } from './dto/traceability.dto.js';

@Injectable()
export class TraceabilityService {
  constructor(
    @InjectRepository(MaterialLot) private readonly lotRepo: Repository<MaterialLot>,
    @InjectRepository(SerialUnit) private readonly serialRepo: Repository<SerialUnit>,
    @InjectRepository(GenealogyLink) private readonly linkRepo: Repository<GenealogyLink>,
  ) {}

  private get org(): string { return TenantContext.requireOrganizationId(); }

  // ---- Lots ----
  createLot(dto: CreateMaterialLotDto): Promise<MaterialLot> {
    const lot = this.lotRepo.create({
      ...(dto as any),
      remainingQuantity: dto.receivedQuantity,
      receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
      organizationId: this.org,
    });
    return this.lotRepo.save(lot as any);
  }
  listLots(materialId?: string): Promise<MaterialLot[]> {
    const where: any = { organizationId: this.org };
    if (materialId) where.materialId = materialId;
    return this.lotRepo.find({ where, order: { createdAt: 'DESC' } as any });
  }

  // ---- Serials ----
  createSerial(dto: CreateSerialDto): Promise<SerialUnit> {
    return this.serialRepo.save(this.serialRepo.create({ ...(dto as any), organizationId: this.org }) as any);
  }
  listSerials(workOrderId?: string): Promise<SerialUnit[]> {
    const where: any = { organizationId: this.org };
    if (workOrderId) where.workOrderId = workOrderId;
    return this.serialRepo.find({ where, order: { createdAt: 'DESC' } as any });
  }
  async updateSerial(id: string, dto: UpdateSerialDto): Promise<SerialUnit> {
    const s = await this.serialRepo.findOne({ where: { id, organizationId: this.org } as any });
    if (!s) throw new NotFoundException('Serial not found');
    if (dto.status) s.status = dto.status;
    if (dto.producedAt) s.producedAt = new Date(dto.producedAt);
    if (dto.note !== undefined) s.note = dto.note ?? null;
    return this.serialRepo.save(s);
  }

  // ---- Genealogy ----
  async link(dto: LinkGenealogyDto): Promise<GenealogyLink> {
    const serial = await this.serialRepo.findOne({ where: { id: dto.serialId, organizationId: this.org } as any });
    if (!serial) throw new NotFoundException('Serial not found');
    const lot = await this.lotRepo.findOne({ where: { id: dto.materialLotId, organizationId: this.org } as any });
    if (!lot) throw new NotFoundException('Material lot not found');
    lot.remainingQuantity = Math.max(0, Number(lot.remainingQuantity) - Number(dto.quantity));
    await this.lotRepo.save(lot);
    const link = this.linkRepo.create({ ...(dto as any), organizationId: this.org });
    return this.linkRepo.save(link as any);
  }

  /** Forward trace: what a finished unit was built from. */
  async getGenealogy(serialId: string) {
    const serial = await this.serialRepo.findOne({ where: { id: serialId, organizationId: this.org } as any });
    if (!serial) throw new NotFoundException('Serial not found');
    const links = await this.linkRepo.find({ where: { serialId, organizationId: this.org } as any });
    const lotIds = links.map((l) => l.materialLotId);
    const lots = lotIds.length ? await this.lotRepo.find({ where: { id: In(lotIds), organizationId: this.org } as any }) : [];
    const lotMap = new Map(lots.map((l) => [l.id, l]));
    return {
      serial,
      components: links.map((l) => ({
        materialLotId: l.materialLotId,
        quantity: Number(l.quantity),
        lot: lotMap.get(l.materialLotId) ?? null,
      })),
    };
  }

  /** Backward trace (recall): which finished units used a given lot. */
  async whereUsed(lotId: string) {
    const links = await this.linkRepo.find({ where: { materialLotId: lotId, organizationId: this.org } as any });
    const serialIds = links.map((l) => l.serialId);
    const serials = serialIds.length
      ? await this.serialRepo.find({ where: { id: In(serialIds), organizationId: this.org } as any })
      : [];
    return { lotId, serials };
  }
}
