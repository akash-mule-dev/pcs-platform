import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Equipment, EquipmentStatus } from './entities/equipment.entity.js';
import { DowntimeEvent } from './entities/downtime-event.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { OpenDowntimeDto, CloseDowntimeDto } from './dto/equipment.dto.js';

@Injectable()
export class EquipmentService extends TenantScopedService<Equipment> {
  constructor(
    @InjectRepository(Equipment) repo: Repository<Equipment>,
    @InjectRepository(DowntimeEvent) private readonly downtimeRepo: Repository<DowntimeEvent>,
  ) {
    super(repo);
  }

  async setStatus(id: string, status: EquipmentStatus): Promise<Equipment> {
    const eq = await this.findOne(id);
    eq.status = status;
    return this.repo.save(eq);
  }

  async openDowntime(equipmentId: string, dto: OpenDowntimeDto): Promise<DowntimeEvent> {
    const eq = await this.findOne(equipmentId);
    const existing = await this.downtimeRepo.findOne({
      where: { equipmentId, endTime: IsNull(), organizationId: this.organizationId } as any,
    });
    if (existing) throw new BadRequestException('Equipment already has an open downtime event');
    const ev = this.downtimeRepo.create({
      organizationId: this.organizationId,
      equipmentId,
      reason: dto.reason,
      startTime: new Date(),
      note: dto.note ?? null,
      createdBy: TenantContext.get()?.userId ?? null,
    } as any);
    const saved = await this.downtimeRepo.save(ev as any);
    eq.status = EquipmentStatus.DOWN;
    await this.repo.save(eq);
    return saved as any;
  }

  async closeDowntime(equipmentId: string, dto: CloseDowntimeDto): Promise<DowntimeEvent> {
    const eq = await this.findOne(equipmentId);
    const ev = await this.downtimeRepo.findOne({
      where: { equipmentId, endTime: IsNull(), organizationId: this.organizationId } as any,
    });
    if (!ev) throw new NotFoundException('No open downtime event for this equipment');
    ev.endTime = new Date();
    ev.durationSeconds = Math.round((ev.endTime.getTime() - new Date(ev.startTime).getTime()) / 1000);
    if (dto.note) ev.note = dto.note;
    await this.downtimeRepo.save(ev);
    eq.status = EquipmentStatus.IDLE;
    await this.repo.save(eq);
    return ev;
  }

  async getDowntime(equipmentId?: string): Promise<DowntimeEvent[]> {
    const where: any = { organizationId: this.organizationId };
    if (equipmentId) where.equipmentId = equipmentId;
    return this.downtimeRepo.find({ where, order: { startTime: 'DESC' }, take: 200 });
  }

  /**
   * Equipment effectiveness for [start,end]: REAL availability from downtime
   * (not the old target/actual proxy), plus MTBF / MTTR and a downtime Pareto.
   */
  async effectiveness(startDate?: string, endDate?: string) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 7 * 24 * 3600 * 1000);
    const periodSeconds = Math.max(1, (end.getTime() - start.getTime()) / 1000);

    const activeEquipment = await this.repo.find({
      where: { organizationId: this.organizationId, isActive: true } as any,
    });
    const equipmentCount = activeEquipment.length || 1;

    const events = await this.downtimeRepo.find({ where: { organizationId: this.organizationId } as any });
    let downtimeSeconds = 0;
    let failures = 0;
    const byReason: Record<string, number> = {};
    for (const e of events) {
      const s = new Date(e.startTime).getTime();
      const eEnd = e.endTime ? new Date(e.endTime).getTime() : end.getTime();
      const overlapStart = Math.max(s, start.getTime());
      const overlapEnd = Math.min(eEnd, end.getTime());
      if (overlapEnd > overlapStart) {
        const dur = (overlapEnd - overlapStart) / 1000;
        downtimeSeconds += dur;
        byReason[e.reason] = (byReason[e.reason] || 0) + dur;
        failures += 1;
      }
    }

    const plannedSeconds = equipmentCount * periodSeconds;
    const availability = Math.max(0, Math.min(1, 1 - downtimeSeconds / plannedSeconds));
    const uptimeSeconds = Math.max(0, plannedSeconds - downtimeSeconds);
    const mttrSeconds = failures > 0 ? downtimeSeconds / failures : 0;
    const mtbfSeconds = failures > 0 ? uptimeSeconds / failures : uptimeSeconds;

    return {
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      equipmentCount,
      availabilityPct: Number((availability * 100).toFixed(1)),
      downtimeSeconds: Math.round(downtimeSeconds),
      failures,
      mttrSeconds: Math.round(mttrSeconds),
      mtbfSeconds: Math.round(mtbfSeconds),
      downtimeByReason: Object.entries(byReason)
        .map(([reason, seconds]) => ({ reason, seconds: Math.round(seconds) }))
        .sort((a, b) => b.seconds - a.seconds),
    };
  }
}
