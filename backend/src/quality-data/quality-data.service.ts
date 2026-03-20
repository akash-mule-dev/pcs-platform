import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QualityData } from './quality-data.entity.js';
import { CreateQualityDataDto } from './dto/create-quality-data.dto.js';
import { UpdateQualityDataDto } from './dto/update-quality-data.dto.js';
import { BulkCreateQualityDataDto } from './dto/bulk-create-quality-data.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';

@Injectable()
export class QualityDataService {
  constructor(@InjectRepository(QualityData) private readonly repo: Repository<QualityData>) {}

  async findAll(pageOptions: PageOptionsDto, modelId?: string): Promise<PageDto<QualityData>> {
    const qb = this.repo.createQueryBuilder('qd')
      .leftJoinAndSelect('qd.model', 'model')
      .orderBy('qd.createdAt', pageOptions.order)
      .skip(pageOptions.skip)
      .take(pageOptions.limit);

    if (modelId) {
      qb.where('qd.model_id = :modelId', { modelId });
    }

    const [items, count] = await qb.getManyAndCount();
    return new PageDto(items, new PageMetaDto(pageOptions, count));
  }

  async findByModel(modelId: string): Promise<QualityData[]> {
    return this.repo.find({
      where: { modelId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<QualityData> {
    const item = await this.repo.findOne({ where: { id }, relations: ['model'] });
    if (!item) throw new NotFoundException('Quality data not found');
    return item;
  }

  async bulkCreate(dto: BulkCreateQualityDataDto): Promise<QualityData[]> {
    const entities = dto.items.map(item => this.repo.create(item));
    return this.repo.save(entities);
  }

  async update(id: string, dto: UpdateQualityDataDto): Promise<QualityData> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    // Phase 12: Soft delete instead of hard delete
    item.isActive = false;
    await this.repo.save(item);
  }

  async removeByModel(modelId: string): Promise<void> {
    await this.repo.delete({ modelId });
  }

  async getSummary(modelId: string): Promise<{ total: number; pass: number; fail: number; warning: number }> {
    const data = await this.repo.find({ where: { modelId } });
    return {
      total: data.length,
      pass: data.filter(d => d.status === 'pass').length,
      fail: data.filter(d => d.status === 'fail').length,
      warning: data.filter(d => d.status === 'warning').length,
    };
  }

  /** Phase 6: Trend tracking — quality status over time grouped by inspection date */
  async getTrends(modelId: string): Promise<any[]> {
    return this.repo.createQueryBuilder('qd')
      .select("DATE(qd.inspection_date)", 'date')
      .addSelect('qd.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('qd.model_id = :modelId', { modelId })
      .andWhere('qd.inspection_date IS NOT NULL')
      .groupBy("DATE(qd.inspection_date)")
      .addGroupBy('qd.status')
      .orderBy("DATE(qd.inspection_date)", 'ASC')
      .getRawMany();
  }

  /** Phase 6: Defect pattern analysis — recurring failures by mesh region */
  async getDefectPatterns(modelId: string): Promise<any[]> {
    return this.repo.createQueryBuilder('qd')
      .select('qd.mesh_name', 'meshName')
      .addSelect('qd.region_label', 'regionLabel')
      .addSelect('qd.defect_type', 'defectType')
      .addSelect('COUNT(*)', 'occurrences')
      .addSelect('AVG(CASE WHEN qd.status = \'fail\' THEN 1 ELSE 0 END) * 100', 'failRate')
      .where('qd.model_id = :modelId', { modelId })
      .groupBy('qd.mesh_name')
      .addGroupBy('qd.region_label')
      .addGroupBy('qd.defect_type')
      .having('COUNT(*) > 1')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();
  }

  /** Phase 6: Sign-off workflow */
  async signoff(id: string, status: 'approved' | 'rejected', signoffBy: string, notes?: string): Promise<QualityData> {
    const item = await this.findOne(id);
    item.signoffStatus = status;
    item.signoffBy = signoffBy;
    item.signoffDate = new Date();
    if (notes) item.signoffNotes = notes;
    return this.repo.save(item);
  }

  /** Phase 6: Auto-fail validation — check measurement against tolerance */
  async create(dto: CreateQualityDataDto): Promise<QualityData> {
    // Auto-set status to 'fail' if measurement is outside tolerance
    if (
      dto.measurementValue !== undefined &&
      dto.measurementValue !== null &&
      ((dto.toleranceMin !== undefined && dto.toleranceMin !== null && dto.measurementValue < dto.toleranceMin) ||
       (dto.toleranceMax !== undefined && dto.toleranceMax !== null && dto.measurementValue > dto.toleranceMax))
    ) {
      dto.status = 'fail';
    }
    return this.repo.save(this.repo.create(dto));
  }

  /** Phase 6: Get items pending sign-off */
  async getPendingSignoffs(modelId?: string): Promise<QualityData[]> {
    const where: any = { signoffStatus: 'pending', status: 'fail' };
    if (modelId) where.modelId = modelId;
    return this.repo.find({ where, relations: ['model'], order: { createdAt: 'DESC' } });
  }
}
