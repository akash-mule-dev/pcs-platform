import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Material } from './entities/material.entity.js';
import { MaterialStock } from './entities/material-stock.entity.js';
import { StockMovement } from './entities/stock-movement.entity.js';
import { BomItem } from './entities/bom-item.entity.js';
import { MaterialsService } from './materials.service.js';
import { InventoryService } from './inventory.service.js';
import { MaterialsController } from './materials.controller.js';
import { BomController } from './bom.controller.js';
import { InventoryController } from './inventory.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Material, MaterialStock, StockMovement, BomItem])],
  controllers: [MaterialsController, BomController, InventoryController],
  providers: [MaterialsService, InventoryService],
  exports: [MaterialsService, InventoryService, TypeOrmModule],
})
export class MaterialsModule {}
