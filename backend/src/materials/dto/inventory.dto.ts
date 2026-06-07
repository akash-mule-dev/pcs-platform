import { IsUUID, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReceiveStockDto {
  @ApiProperty() @IsUUID() materialId: string;
  @ApiProperty() @IsNumber() @Min(0) quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional({ description: 'PO number / supplier ref' }) @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class IssueStockDto {
  @ApiProperty() @IsUUID() materialId: string;
  @ApiProperty() @IsNumber() @Min(0) quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class ScrapStockDto {
  @ApiProperty() @IsUUID() materialId: string;
  @ApiProperty() @IsNumber() @Min(0) quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class AdjustStockDto {
  @ApiProperty() @IsUUID() materialId: string;
  @ApiProperty({ description: 'Absolute on-hand quantity to set' }) @IsNumber() @Min(0) quantityOnHand: number;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
