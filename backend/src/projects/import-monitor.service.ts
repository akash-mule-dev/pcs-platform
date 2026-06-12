import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ImportFile, ImportFileStatus } from './import-file.entity.js';
import { Project } from './project.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

const ACTIVE_STATUSES = [
  ImportFileStatus.UPLOADED,
  ImportFileStatus.EXTRACTING,
  ImportFileStatus.CONVERTING,
];

export interface MonitorActiveRow extends ImportFile {
  projectName: string | null;
  /** Packages of THIS org created earlier and still active — "N ahead of yours". */
  ahead: number;
}

export interface ImportsMonitor {
  active: MonitorActiveRow[];
  kpis: {
    inProgress: number;
    queued: number;
    processing: number;
    completedToday: number;
    failedToday: number;
    completedTotal: number;
    failedTotal: number;
    totalPackages: number;
  };
}

export interface ImportsHistoryQuery {
  projectIds?: string[];
  sort?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Tenant-wide package monitoring: everything currently in the import pipeline
 * (with live stage/progress and queue position) + the full upload history
 * across all of the org's projects. Backs the global "Package Monitor" page;
 * the per-project Monitoring tab stays the place for per-import timelines.
 */
@Injectable()
export class ImportMonitorService {
  constructor(
    @InjectRepository(ImportFile) private readonly importRepo: Repository<ImportFile>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
  ) {}

  async monitor(): Promise<ImportsMonitor> {
    const organizationId = TenantContext.requireOrganizationId();

    const active = await this.importRepo.find({
      where: { organizationId, status: In(ACTIVE_STATUSES) },
      order: { createdAt: 'ASC' }, // front of the queue first
    });
    const names = await this.projectNames(active.map((a) => a.projectId));

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalPackages, completedTotal, failedTotal, completedToday, failedToday] = await Promise.all([
      this.importRepo.count({ where: { organizationId } }),
      this.importRepo.count({ where: { organizationId, status: ImportFileStatus.COMPLETED } }),
      this.importRepo.count({ where: { organizationId, status: ImportFileStatus.FAILED } }),
      this.importRepo
        .createQueryBuilder('i')
        .where('i.organization_id = :org', { org: organizationId })
        .andWhere('i.status = :st', { st: ImportFileStatus.COMPLETED })
        .andWhere('i.finished_at >= :t', { t: todayStart })
        .getCount(),
      this.importRepo
        .createQueryBuilder('i')
        .where('i.organization_id = :org', { org: organizationId })
        .andWhere('i.status = :st', { st: ImportFileStatus.FAILED })
        .andWhere('i.finished_at >= :t', { t: todayStart })
        .getCount(),
    ]);

    const rows: MonitorActiveRow[] = active.map((imp, idx) =>
      Object.assign(imp, {
        projectName: names.get(imp.projectId) ?? null,
        ahead: idx, // active list is createdAt ASC → everything before you
      }),
    );
    const queued = rows.filter((r) => r.stage === 'queued').length;

    return {
      active: rows,
      kpis: {
        inProgress: rows.length,
        queued,
        processing: rows.length - queued,
        completedToday,
        failedToday,
        completedTotal,
        failedTotal,
        totalPackages,
      },
    };
  }

  async history(q: ImportsHistoryQuery): Promise<{ rows: (ImportFile & { projectName: string | null })[]; total: number }> {
    const organizationId = TenantContext.requireOrganizationId();
    const where: Record<string, unknown> = { organizationId };
    if (q.projectIds?.length) where.projectId = In(q.projectIds);

    const take = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const skip = Math.max(q.offset ?? 0, 0);
    const [rows, total] = await this.importRepo.findAndCount({
      where,
      order: { createdAt: q.sort === 'asc' ? 'ASC' : 'DESC' },
      take,
      skip,
    });
    const names = await this.projectNames(rows.map((r) => r.projectId));
    return {
      rows: rows.map((r) => Object.assign(r, { projectName: names.get(r.projectId) ?? null })),
      total,
    };
  }

  private async projectNames(projectIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(projectIds)];
    if (!ids.length) return new Map();
    const projects = await this.projectRepo.find({ where: { id: In(ids) }, select: ['id', 'name'] });
    return new Map(projects.map((p) => [p.id, p.name]));
  }
}
