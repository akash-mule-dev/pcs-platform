import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit.entity.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  async log(data: {
    userId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    oldValues?: Record<string, any> | null;
    newValues?: Record<string, any> | null;
    ipAddress?: string | null;
  }): Promise<AuditLog> {
    return this.repo.save(this.repo.create(data));
  }

  async findAll(
    pageOptions: PageOptionsDto,
    entityType?: string,
    entityId?: string,
    userId?: string,
  ): Promise<PageDto<AuditLog>> {
    const qb = this.repo.createQueryBuilder('al')
      .leftJoinAndSelect('al.user', 'user')
      .orderBy('al.createdAt', 'DESC')
      .skip(pageOptions.skip)
      .take(pageOptions.limit);

    if (entityType) qb.andWhere('al.entity_type = :entityType', { entityType });
    if (entityId) qb.andWhere('al.entity_id = :entityId', { entityId });
    if (userId) qb.andWhere('al.user_id = :userId', { userId });

    const [items, count] = await qb.getManyAndCount();
    return new PageDto(items, new PageMetaDto(pageOptions, count));
  }
}
