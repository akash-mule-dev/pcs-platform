import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { User } from '../auth/entities/user.entity.js';

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(WorkOrder) private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async search(query: string, limit = 10): Promise<{
    workOrders: any[];
    users: any[];
  }> {
    const q = `%${query.toLowerCase()}%`;

    const workOrders = await this.woRepo.createQueryBuilder('wo')
      .where('LOWER(wo.order_number) LIKE :q', { q })
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

    return { workOrders, users };
  }
}
