import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Model3D } from './model.entity.js';
import { CreateModelDto } from './dto/create-model.dto.js';
import { UpdateModelDto } from './dto/update-model.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';
import type { StorageProvider } from '../storage/storage.interface.js';
import { STORAGE_PROVIDER } from '../storage/storage.interface.js';
import * as path from 'path';

@Injectable()
export class ModelsService {
  constructor(
    @InjectRepository(Model3D) private readonly repo: Repository<Model3D>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async findAll(pageOptions: PageOptionsDto, modelType?: string): Promise<PageDto<Model3D>> {
    const qb = this.repo.createQueryBuilder('model')
      .leftJoinAndSelect('model.product', 'product')
      .orderBy('model.createdAt', pageOptions.order)
      .skip(pageOptions.skip)
      .take(pageOptions.limit);

    if (modelType) {
      qb.where('model.model_type = :modelType', { modelType });
    }

    const [items, count] = await qb.getManyAndCount();
    return new PageDto(items, new PageMetaDto(pageOptions, count));
  }

  async findOne(id: string): Promise<Model3D> {
    const item = await this.repo.findOne({ where: { id }, relations: ['product'] });
    if (!item) throw new NotFoundException('3D Model not found');
    return item;
  }

  async create(dto: CreateModelDto, file: Express.Multer.File): Promise<Model3D> {
    const storageKey = file.filename;

    // Upload to storage provider (for local, file is already in place from multer)
    await this.storage.upload(file.path, storageKey, file.mimetype);

    const model = this.repo.create({
      name: dto.name,
      description: dto.description,
      modelType: dto.modelType || 'assembly',
      productId: dto.productId,
      fileName: storageKey,
      originalName: file.originalname,
      filePath: storageKey, // Now stores the storage key, not a filesystem path
      fileSize: file.size,
      mimeType: file.mimetype,
      fileFormat: path.extname(file.originalname).replace('.', '').toLowerCase(),
    });
    return this.repo.save(model);
  }

  async update(id: string, dto: UpdateModelDto): Promise<Model3D> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.storage.delete(item.fileName);
    await this.repo.remove(item);
  }

  async getFileStream(id: string): Promise<{ stream: NodeJS.ReadableStream; model: Model3D }> {
    const model = await this.findOne(id);
    const stream = await this.storage.download(model.fileName);
    return { stream, model };
  }
}
