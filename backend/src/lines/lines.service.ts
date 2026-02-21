import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Line } from './line.entity.js';
import { CreateLineDto } from './dto/create-line.dto.js';
import { UpdateLineDto } from './dto/update-line.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';

@Injectable()
export class LinesService {
  constructor(@InjectRepository(Line) private readonly repo: Repository<Line>) {}

  async findAll(pageOptions: PageOptionsDto): Promise<PageDto<Line>> {
    const [items, count] = await this.repo.findAndCount({
      relations: ['stations'],
      order: { createdAt: pageOptions.order },
      skip: pageOptions.skip,
      take: pageOptions.limit,
    });
    return new PageDto(items, new PageMetaDto(pageOptions, count));
  }

  async findOne(id: string): Promise<Line> {
    const item = await this.repo.findOne({ where: { id }, relations: ['stations'] });
    if (!item) throw new NotFoundException('Line not found');
    return item;
  }

  async create(dto: CreateLineDto): Promise<Line> {
    return this.repo.save(this.repo.create(dto));
  }

  async update(id: string, dto: UpdateLineDto): Promise<Line> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repo.remove(item);
  }
}
