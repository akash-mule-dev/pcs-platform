import { IsString, IsNotEmpty, IsOptional, IsEnum, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { EquipmentType, EquipmentStatus } from '../entities/equipment.entity.js';
import { DowntimeReason } from '../entities/downtime-event.entity.js';

export class CreateEquipmentDto {
  @ApiProperty() @IsString() @IsNotEmpty() code: string;
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional({ enum: EquipmentType }) @IsOptional() @IsEnum(EquipmentType) type?: EquipmentType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() lineId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() stationId?: string;
}
export class UpdateEquipmentDto extends PartialType(CreateEquipmentDto) {}

export class UpdateEquipmentStatusDto {
  @ApiProperty({ enum: EquipmentStatus }) @IsEnum(EquipmentStatus) status: EquipmentStatus;
}

export class OpenDowntimeDto {
  @ApiProperty({ enum: DowntimeReason }) @IsEnum(DowntimeReason) reason: DowntimeReason;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
export class CloseDowntimeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
