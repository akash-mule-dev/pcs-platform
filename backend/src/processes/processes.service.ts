import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Process } from './process.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { CreateProcessDto } from './dto/create-process.dto.js';
import { UpdateProcessDto } from './dto/update-process.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';
import { TenantContext } from '../common/tenant/tenant-context.js';

@Injectable()
export class ProcessesService {
  constructor(
    @InjectRepository(Process) private readonly repo: Repository<Process>,
    @InjectRepository(Stage) private readonly stageRepo: Repository<Stage>,
  ) {}

  async findAll(pageOptions: PageOptionsDto): Promise<PageDto<Process>> {
    const [items, count] = await this.repo.findAndCount({
      where: { organizationId: TenantContext.getOrganizationId() ?? undefined },
      relations: ['stages'],
      order: { createdAt: pageOptions.order },
      skip: pageOptions.skip,
      take: pageOptions.limit,
    });
    return new PageDto(items, new PageMetaDto(pageOptions, count));
  }

  async findOne(id: string): Promise<Process> {
    const item = await this.repo.findOne({ where: { id, organizationId: TenantContext.getOrganizationId() ?? undefined }, relations: ['stages'] });
    if (!item) throw new NotFoundException('Process not found');
    return item;
  }

  /** The default fabrication routing, created on demand (idempotent per organization). */
  static readonly STANDARD_NAME = 'Standard Fabrication';
  private static readonly STANDARD_STAGES = [
    { name: 'Cutting', targetTimeSeconds: 1800, description: 'Cut raw stock to size' },
    { name: 'Fit-Up', targetTimeSeconds: 3600, description: 'Assemble and tack the parts' },
    { name: 'Welding', targetTimeSeconds: 7200, description: 'Full welds per WPS' },
    { name: 'Quality Check', targetTimeSeconds: 1800, description: 'Visual + dimensional inspection — blocked while NCRs are open' },
    { name: 'Painting', targetTimeSeconds: 3600, description: 'Surface prep and coating' },
  ];

  /** Get-or-create the organization's "Standard Fabrication" process (Cut → Fit → Weld → QC → Paint). */
  async ensureStandard(): Promise<Process> {
    const organizationId = TenantContext.requireOrganizationId();
    const existing = await this.repo.findOne({
      where: { name: ProcessesService.STANDARD_NAME, organizationId },
      relations: ['stages'],
    });
    if (existing) return existing;
    const saved = await this.repo.save(this.repo.create({ name: ProcessesService.STANDARD_NAME, version: 1 }));
    await this.stageRepo.save(
      ProcessesService.STANDARD_STAGES.map((s, i) => this.stageRepo.create({ ...s, sequence: i + 1, processId: saved.id })),
    );
    return this.findOne(saved.id);
  }

  async create(dto: CreateProcessDto): Promise<Process> {
    // Processes are standalone workflow templates — not tied to a product.
    const entity = this.repo.create({ name: dto.name, version: dto.version ?? 1 });
    const saved = await this.repo.save(entity);
    if (dto.stages?.length) {
      const stageEntities = dto.stages.map((s, i) =>
        this.stageRepo.create({ ...s, sequence: i + 1, processId: saved.id }),
      );
      await this.stageRepo.save(stageEntities);
    }
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateProcessDto): Promise<Process> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    await this.repo.save(item);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repo.remove(item);
  }
}
