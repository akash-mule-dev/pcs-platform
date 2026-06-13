import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { ProductionOrder } from './production-order.entity.js';
import { Material } from '../materials/entities/material.entity.js';
import { MaterialStock } from '../materials/entities/material-stock.entity.js';
import { StockMovement } from '../materials/entities/stock-movement.entity.js';
import { MaterialRequirementsService } from './material-requirements.service.js';
import { MaterialPlanningController } from './material-planning.controller.js';

/**
 * Material planning (BOM ⇄ inventory bridge). Entity-only imports from the
 * projects + materials domains — keeps the module graph acyclic so the costing
 * module can consume MaterialRequirementsService for estimates.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Project, AssemblyNode, ProductionOrder, Material, MaterialStock, StockMovement])],
  controllers: [MaterialPlanningController],
  providers: [MaterialRequirementsService],
  exports: [MaterialRequirementsService],
})
export class MaterialPlanningModule {}
