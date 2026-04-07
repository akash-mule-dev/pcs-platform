import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Process } from './process.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { CreateProcessDto } from './dto/create-process.dto.js';
import { UpdateProcessDto } from './dto/update-process.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';

@Injectable()
export class ProcessesService {
  constructor(
    @InjectRepository(Process) private readonly repo: Repository<Process>,
    @InjectRepository(Stage) private readonly stageRepo: Repository<Stage>,
  ) {}

  async findAll(pageOptions: PageOptionsDto): Promise<PageDto<Process>> {
    const [items, count] = await this.repo.findAndCount({
      relations: ['stages', 'product'],
      order: { createdAt: pageOptions.order },
      skip: pageOptions.skip,
      take: pageOptions.limit,
    });
    return new PageDto(items, new PageMetaDto(pageOptions, count));
  }

  async findOne(id: string): Promise<Process> {
    const item = await this.repo.findOne({ where: { id }, relations: ['stages', 'product'] });
    if (!item) throw new NotFoundException('Process not found');
    return item;
  }

  async create(dto: CreateProcessDto): Promise<Process> {
    let version = dto.version;
    if (version == null) {
      const result = await this.repo
        .createQueryBuilder('p')
        .select('COALESCE(MAX(p.version), 0)', 'maxVersion')
        .where('p.product_id = :productId', { productId: dto.productId })
        .getRawOne();
      version = (result?.maxVersion ?? 0) + 1;
    }
    const entity = this.repo.create({ name: dto.name, version, productId: dto.productId });
    try {
      const saved = await this.repo.save(entity);
      if (dto.stages?.length) {
        const stageEntities = dto.stages.map((s, i) =>
          this.stageRepo.create({ ...s, sequence: i + 1, processId: saved.id }),
        );
        await this.stageRepo.save(stageEntities);
      }
      return this.findOne(saved.id);
    } catch (err: any) {
      if (err.code === '23505' || err.code === 'SQLITE_CONSTRAINT') {
        throw new ConflictException(`A process for this product with version ${version} already exists`);
      }
      throw err;
    }
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
