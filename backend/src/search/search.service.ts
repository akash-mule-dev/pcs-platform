import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { Product } from '../products/product.entity.js';
import { User } from '../auth/entities/user.entity.js';

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async search(query: string, limit = 10): Promise<{
    workOrders: any[];
    products: any[];
    users: any[];
  }> {
    const q = `%${query.toLowerCase()}%`;

    const workOrders = await this.woRepo.createQueryBuilder('wo')
      .leftJoinAndSelect('wo.product', 'product')
      .where('LOWER(wo.order_number) LIKE :q', { q })
      .orWhere('LOWER(product.name) LIKE :q', { q })
      .orWhere('LOWER(product.description) LIKE :q', { q })
      .take(limit)
      .getMany();

    const products = await this.productRepo.createQueryBuilder('p')
      .where('LOWER(p.name) LIKE :q', { q })
      .orWhere('LOWER(p.description) LIKE :q', { q })
      .take(limit)
      .getMany();

    const users = await this.userRepo.createQueryBuilder('u')
      .where(new Brackets(qb => {
        qb.where('LOWER(u.first_name) LIKE :q', { q })
          .orWhere('LOWER(u.last_name) LIKE :q', { q })
          .orWhere('LOWER(u.employee_id) LIKE :q', { q });
      }))
      .andWhere('u.is_active = true')
      .take(limit)
      .getMany();

    return { workOrders, products, users };
  }
}
