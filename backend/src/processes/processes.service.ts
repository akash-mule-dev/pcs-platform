import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Process } from './process.entity.js';
import { CreateProcessDto } from './dto/create-process.dto.js';
import { UpdateProcessDto } from './dto/update-process.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';

@Injectable()
export class ProcessesService {
  constructor(@InjectRepository(Process) private readonly repo: Repository<Process>) {}

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
    const entity = this.repo.create({ name: dto.name, version: dto.version ?? 1, productId: dto.productId });
    const saved = await this.repo.save(entity);
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
