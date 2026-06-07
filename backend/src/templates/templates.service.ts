import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FormTemplate } from './entities/form-template.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';

@Injectable()
export class TemplatesService extends TenantScopedService<FormTemplate> {
  constructor(@InjectRepository(FormTemplate) repo: Repository<FormTemplate>) {
    super(repo);
  }

  /** Templates of a given type (e.g. all NCR templates), tenant-scoped. */
  listByType(type?: string): Promise<FormTemplate[]> {
    return this.findAll(type ? { type } : {});
  }
}
