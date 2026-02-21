import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Stage } from './stage.entity.js';
import { CreateStageDto } from './dto/create-stage.dto.js';
import { UpdateStageDto } from './dto/update-stage.dto.js';

@Injectable()
export class StagesService {
  constructor(@InjectRepository(Stage) private readonly repo: Repository<Stage>) {}

  async createForProcess(processId: string, dto: CreateStageDto): Promise<Stage> {
    const stage = this.repo.create({ ...dto, processId });
    return this.repo.save(stage);
  }

  async findOne(id: string): Promise<Stage> {
    const stage = await this.repo.findOne({ where: { id }, relations: ['process'] });
    if (!stage) throw new NotFoundException('Stage not found');
    return stage;
  }

  async update(id: string, dto: UpdateStageDto): Promise<Stage> {
    const stage = await this.findOne(id);
    Object.assign(stage, dto);
    return this.repo.save(stage);
  }

  async remove(id: string): Promise<void> {
    const stage = await this.findOne(id);
    await this.repo.remove(stage);
  }

  async reorder(processId: string, stageIds: string[]): Promise<Stage[]> {
    const stages: Stage[] = [];
    for (let i = 0; i < stageIds.length; i++) {
      await this.repo.update(stageIds[i], { sequence: i + 1 });
      const s = await this.repo.findOne({ where: { id: stageIds[i] } });
      if (s) stages.push(s);
    }
    return stages;
  }
}
