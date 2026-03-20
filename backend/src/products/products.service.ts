import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity.js';
import { Model3D } from '../models/model.entity.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { PageOptionsDto, PageDto, PageMetaDto } from '../common/dto/pagination.dto.js';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private readonly repo: Repository<Product>,
    @InjectRepository(Model3D) private readonly modelRepo: Repository<Model3D>,
  ) {}

  async findAll(pageOptions: PageOptionsDto): Promise<PageDto<Product>> {
    const [items, count] = await this.repo.findAndCount({
      relations: ['models'],
      order: { createdAt: pageOptions.order },
      skip: pageOptions.skip,
      take: pageOptions.limit,
    });
    return new PageDto(items, new PageMetaDto(pageOptions, count));
  }

  async findOne(id: string): Promise<Product> {
    const item = await this.repo.findOne({ where: { id }, relations: ['models'] });
    if (!item) throw new NotFoundException('Product not found');
    return item;
  }

  async create(dto: CreateProductDto): Promise<Product> {
    return this.repo.save(this.repo.create(dto));
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repo.remove(item);
  }

  async findModelsByProduct(productId: string): Promise<Model3D[]> {
    await this.findOne(productId); // ensure product exists
    return this.modelRepo.find({
      where: { productId },
      order: { createdAt: 'DESC' },
    });
  }
}
