import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Station } from './station.entity.js';
import { CreateStationDto } from './dto/create-station.dto.js';
import { UpdateStationDto } from './dto/update-station.dto.js';

@Injectable()
export class StationsService {
  constructor(@InjectRepository(Station) private readonly repo: Repository<Station>) {}

  async findByLine(lineId: string): Promise<Station[]> {
    return this.repo.find({ where: { lineId }, order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<Station> {
    const item = await this.repo.findOne({ where: { id }, relations: ['line'] });
    if (!item) throw new NotFoundException('Station not found');
    return item;
  }

  async create(dto: CreateStationDto): Promise<Station> {
    return this.repo.save(this.repo.create(dto));
  }

  async update(id: string, dto: UpdateStationDto): Promise<Station> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repo.remove(item);
  }
}
