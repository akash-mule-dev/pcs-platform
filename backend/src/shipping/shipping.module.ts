import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment } from './shipment.entity.js';
import { ShipmentItem } from './shipment-item.entity.js';
import { ShippingService } from './shipping.service.js';
import { ShippingController } from './shipping.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Shipment, ShipmentItem])],
  controllers: [ShippingController],
  providers: [ShippingService],
  exports: [ShippingService, TypeOrmModule],
})
export class ShippingModule {}
