import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeedService } from './seed.service.js';
import { Role } from '../auth/entities/role.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { Product } from '../products/product.entity.js';
import { Process } from '../processes/process.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { Line } from '../lines/line.entity.js';
import { Station } from '../stations/station.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { TimeEntry } from '../time-tracking/time-entry.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Role, User, Product, Process, Stage, Line, Station,
      WorkOrder, WorkOrderStage, TimeEntry,
    ]),
  ],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
