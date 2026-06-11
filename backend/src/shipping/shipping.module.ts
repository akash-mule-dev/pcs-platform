import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment } from './shipment.entity.js';
import { ShipmentItem } from './shipment-item.entity.js';
import { AssemblyNode } from '../projects/assembly-node.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { Ncr } from '../quality-ncr/entities/ncr.entity.js';
import { ShippingService } from './shipping.service.js';
import { ShippingController } from './shipping.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Shipment, ShipmentItem, AssemblyNode, WorkOrder, WorkOrderStage, Ncr])],
  controllers: [ShippingController],
  providers: [ShippingService],
  exports: [ShippingService, TypeOrmModule],
})
export class ShippingModule {}
