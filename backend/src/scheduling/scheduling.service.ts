import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { Line } from '../lines/line.entity.js';
import { Organization } from '../organization/organization.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

const DAY_MS = 24 * 3600 * 1000;

/**
 * Finite-capacity view: estimated production load per line vs. capacity for a
 * window. Estimate = sum(stage target times for the WO's process) x quantity.
 */
@Injectable()
export class SchedulingService {
  constructor(
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(Stage) private readonly stageRepo: Repository<Stage>,
    @InjectRepository(Line) private readonly lineRepo: Repository<Line>,
    @InjectRepository(Organization) private readonly orgRepo: Repository<Organization>,
  ) {}

  private get org(): string { return TenantContext.requireOrganizationId(); }

  async load(startDate?: string, endDate?: string) {
    const o = await this.orgRepo.findOne({ where: { id: this.org } as any });
    const hoursPerDay = (o?.settings as any)?.lineHoursPerDay ?? 8;
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(Date.now() + 7 * DAY_MS);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS));
    const capacityHours = hoursPerDay * days;

    const lines = await this.lineRepo.find();
    const wos = await this.woRepo.find({
      where: [{ status: 'draft' as any }, { status: 'pending' as any }, { status: 'in_progress' as any }],
    });

    const processIds = [...new Set(wos.map((w) => w.processId).filter(Boolean))];
    const stages = processIds.length ? await this.stageRepo.find({ where: { processId: In(processIds) } as any }) : [];
    const secByProcess: Record<string, number> = {};
    for (const s of stages) {
      secByProcess[s.processId] = (secByProcess[s.processId] || 0) + (Number(s.targetTimeSeconds) || 0);
    }

    const byLine: Record<string, number> = {};
    for (const w of wos) {
      const estHours = ((secByProcess[w.processId] || 0) * (Number(w.quantity) || 0)) / 3600;
      const key = w.lineId || 'unassigned';
      byLine[key] = (byLine[key] || 0) + estHours;
    }

    const lineMap = new Map(lines.map((l) => [l.id, l.name]));
    const result = Object.entries(byLine).map(([lineId, scheduledHours]) => {
      const unassigned = lineId === 'unassigned';
      return {
        lineId: unassigned ? null : lineId,
        lineName: unassigned ? 'Unassigned' : (lineMap.get(lineId) || lineId),
        scheduledHours: Number(scheduledHours.toFixed(1)),
        capacityHours: unassigned ? 0 : capacityHours,
        utilizationPct: unassigned ? null : Number(((scheduledHours / capacityHours) * 100).toFixed(1)),
        overloaded: !unassigned && scheduledHours > capacityHours,
      };
    });

    return { periodStart: start.toISOString(), periodEnd: end.toISOString(), hoursPerDay, days, lines: result };
  }
}
