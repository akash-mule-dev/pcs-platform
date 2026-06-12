import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Material } from './entities/material.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';

@Injectable()
export class MaterialsService extends TenantScopedService<Material> {
  constructor(@InjectRepository(Material) repo: Repository<Material>) {
    super(repo);
  }

  // Material CRUD is inherited (tenant-scoped) from TenantScopedService.
}
