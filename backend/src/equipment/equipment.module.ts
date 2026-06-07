import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Equipment } from './entities/equipment.entity.js';
import { DowntimeEvent } from './entities/downtime-event.entity.js';
import { MaintenancePlan } from './entities/maintenance-plan.entity.js';
import { MaintenanceOrder } from './entities/maintenance-order.entity.js';
import { EquipmentService } from './equipment.service.js';
import { MaintenanceService } from './maintenance.service.js';
import { EquipmentController } from './equipment.controller.js';
import { MaintenanceController } from './maintenance.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Equipment, DowntimeEvent, MaintenancePlan, MaintenanceOrder])],
  controllers: [EquipmentController, MaintenanceController],
  providers: [EquipmentService, MaintenanceService],
  exports: [EquipmentService, MaintenanceService, TypeOrmModule],
})
export class EquipmentModule {}
