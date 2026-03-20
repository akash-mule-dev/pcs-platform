import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchService } from './search.service.js';
import { SearchController } from './search.controller.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { Product } from '../products/product.entity.js';
import { User } from '../auth/entities/user.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([WorkOrder, Product, User])],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
