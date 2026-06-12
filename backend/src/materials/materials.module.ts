import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Material } from './entities/material.entity.js';
import { MaterialStock } from './entities/material-stock.entity.js';
import { StockMovement } from './entities/stock-movement.entity.js';
import { MaterialsService } from './materials.service.js';
import { InventoryService } from './inventory.service.js';
import { MaterialsController } from './materials.controller.js';
import { InventoryController } from './inventory.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Material, MaterialStock, StockMovement])],
  controllers: [MaterialsController, InventoryController],
  providers: [MaterialsService, InventoryService],
  exports: [MaterialsService, InventoryService, TypeOrmModule],
})
export class MaterialsModule {}
