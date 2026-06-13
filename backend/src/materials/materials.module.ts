import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Material } from './entities/material.entity.js';
import { MaterialStock } from './entities/material-stock.entity.js';
import { StockMovement } from './entities/stock-movement.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { ProductionOrder } from '../projects/production-order.entity.js';
import { MaterialsService } from './materials.service.js';
import { InventoryService } from './inventory.service.js';
import { MaterialsController } from './materials.controller.js';
import { InventoryController } from './inventory.controller.js';

@Module({
  // WorkOrder/ProductionOrder are ENTITY-ONLY deps (issue/return reference
  // validation) — same cross-module pattern as shipping (no module import).
  imports: [TypeOrmModule.forFeature([Material, MaterialStock, StockMovement, WorkOrder, ProductionOrder])],
  controllers: [MaterialsController, InventoryController],
  providers: [MaterialsService, InventoryService],
  exports: [MaterialsService, InventoryService, TypeOrmModule],
})
export class MaterialsModule {}
