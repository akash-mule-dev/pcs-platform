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
import * as fs from 'fs';

@Injectable()
export class ModelsService {
  constructor(
    @InjectRepository(Model3D) private readonly repo: Repository<Model3D>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async findAll(pageOptions: PageOptionsDto, modelType?: string): Promise<PageDto<Model3D>> {
    const qb = this.repo.createQueryBuilder('model')
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
    const item = await this.repo.findOne({ where: { id } });
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

  /** Store a client-captured thumbnail PNG and record its storage key on the model. */
  async setThumbnail(id: string, file: Express.Multer.File): Promise<Model3D> {
    const model = await this.findOne(id);
    const key = `thumbnails/${model.id}.png`;
    await this.storage.upload(file.path, key, file.mimetype || 'image/png');
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    model.thumbnailPath = key;
    return this.repo.save(model);
  }

  async getThumbnailStream(id: string): Promise<{ stream: NodeJS.ReadableStream; model: Model3D }> {
    const model = await this.findOne(id);
    if (!model.thumbnailPath) throw new NotFoundException('No thumbnail for this model');
    const stream = await this.storage.download(model.thumbnailPath);
    return { stream, model };
  }
}
