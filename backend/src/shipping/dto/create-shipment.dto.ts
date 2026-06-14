import { IsNotEmpty, IsOptional, IsString, IsUUID, IsEnum, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShipmentStatus } from '../shipment.entity.js';

export class CreateShipmentDto {
  // The work order (production order) this load belongs to. The project is
  // derived from it server-side — clients never supply a projectId.
  @ApiProperty() @IsUUID() productionOrderId: string;
  @ApiProperty() @IsString() @IsNotEmpty() shipmentNumber: string;
  @ApiPropertyOptional({ enum: ShipmentStatus }) @IsEnum(ShipmentStatus) @IsOptional() status?: ShipmentStatus;
  @ApiPropertyOptional() @IsString() @IsOptional() destination?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() carrier?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() plannedDate?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;
}
