import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeEntry } from '../time-tracking/time-entry.entity.js';
import { StockMovement } from '../materials/entities/stock-movement.entity.js';
import { Organization } from '../organization/organization.entity.js';
import { CostingService } from './costing.service.js';
import { CostingController } from './costing.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([TimeEntry, StockMovement, Organization])],
  controllers: [CostingController],
  providers: [CostingService],
  exports: [CostingService],
})
export class CostingModule {}
