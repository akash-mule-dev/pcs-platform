import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsBoolean, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { MaterialType } from '../entities/material.entity.js';

export class CreateMaterialDto {
  @ApiProperty() @IsString() @IsNotEmpty() code: string;
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional({ enum: MaterialType }) @IsOptional() @IsEnum(MaterialType) type?: MaterialType;
  @ApiPropertyOptional() @IsOptional() @IsString() unitOfMeasure?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() specification?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) unitCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) reorderLevel?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateMaterialDto extends PartialType(CreateMaterialDto) {}
