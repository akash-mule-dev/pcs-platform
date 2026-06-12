import { IsString, IsNotEmpty, IsOptional, IsUUID, IsNumber, IsEnum, IsDateString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SerialStatus } from '../entities/serial-unit.entity.js';

export class CreateMaterialLotDto {
  @ApiProperty() @IsUUID() materialId: string;
  @ApiProperty() @IsString() @IsNotEmpty() lotNumber: string;
  @ApiPropertyOptional() @IsOptional() @IsString() heatNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplier?: string;
  @ApiPropertyOptional({ description: 'Mill cert / MTR reference' }) @IsOptional() @IsString() certReference?: string;
  @ApiProperty() @IsNumber() @Min(0) receivedQuantity: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() receivedAt?: string;
}

export class CreateSerialDto {
  @ApiProperty() @IsString() @IsNotEmpty() serialNumber: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workOrderId?: string;
}
export class UpdateSerialDto {
  @ApiPropertyOptional({ enum: SerialStatus }) @IsOptional() @IsEnum(SerialStatus) status?: SerialStatus;
  @ApiPropertyOptional() @IsOptional() @IsDateString() producedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class LinkGenealogyDto {
  @ApiProperty() @IsUUID() serialId: string;
  @ApiProperty() @IsUUID() materialLotId: string;
  @ApiProperty() @IsNumber() @Min(0) quantity: number;
}
