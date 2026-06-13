import { IsUUID, IsNumber, IsOptional, IsString, Min, IsPositive, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReceiveStockDto {
  @ApiProperty() @IsUUID() materialId: string;
  @ApiProperty() @IsNumber() @IsPositive() quantity: number;
  @ApiPropertyOptional({ description: 'Purchase unit cost — re-averages the material unit cost (moving average). Omit to keep the current cost.' })
  @IsOptional() @IsNumber() @Min(0) unitCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) location?: string;
  @ApiPropertyOptional({ description: 'PO number / supplier ref' }) @IsOptional() @IsString() @MaxLength(255) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class IssueStockDto {
  @ApiProperty() @IsUUID() materialId: string;
  @ApiProperty() @IsNumber() @IsPositive() quantity: number;
  @ApiPropertyOptional({ description: 'Production order (customer/run) the material is consumed for — drives per-order costing + requirements tracking.' })
  @IsOptional() @IsUUID() productionOrderId?: string;
  @ApiPropertyOptional({ description: 'Per-assembly work order. Its production order is stamped automatically.' })
  @IsOptional() @IsUUID() workOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class ReturnStockDto {
  @ApiProperty() @IsUUID() materialId: string;
  @ApiProperty() @IsNumber() @IsPositive() quantity: number;
  @ApiPropertyOptional({ description: 'Production order the material was originally issued to.' })
  @IsOptional() @IsUUID() productionOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class ScrapStockDto {
  @ApiProperty() @IsUUID() materialId: string;
  @ApiProperty() @IsNumber() @IsPositive() quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productionOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class AdjustStockDto {
  @ApiProperty() @IsUUID() materialId: string;
  @ApiProperty({ description: 'Absolute on-hand quantity to set' }) @IsNumber() @Min(0) quantityOnHand: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
