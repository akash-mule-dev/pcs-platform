import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { Line } from '../lines/line.entity.js';
import { Organization } from '../organization/organization.entity.js';
import { SchedulingService } from './scheduling.service.js';
import { SchedulingController } from './scheduling.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([WorkOrder, Stage, Line, Organization])],
  controllers: [SchedulingController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
