import { IsString, IsNotEmpty, IsOptional, IsUUID, IsInt, IsEnum, IsDateString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { MaintenanceOrderStatus } from '../entities/maintenance-order.entity.js';

export class CreateMaintenancePlanDto {
  @ApiProperty() @IsUUID() equipmentId: string;
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiProperty() @IsInt() @Min(1) intervalDays: number;
  @ApiPropertyOptional() @IsOptional() @IsString() instructions?: string;
}
export class UpdateMaintenancePlanDto extends PartialType(CreateMaintenancePlanDto) {}

export class CreateMaintenanceOrderDto {
  @ApiProperty() @IsUUID() equipmentId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() planId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledFor?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
export class UpdateMaintenanceOrderDto {
  @ApiPropertyOptional({ enum: MaintenanceOrderStatus }) @IsOptional() @IsEnum(MaintenanceOrderStatus) status?: MaintenanceOrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledFor?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
