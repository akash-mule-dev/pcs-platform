import { IsString, IsNotEmpty, IsOptional, IsEnum, IsUUID, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CapaType, CapaStatus } from '../entities/capa.entity.js';

export class CreateCapaDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() ncrId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: CapaType }) @IsOptional() @IsEnum(CapaType) type?: CapaType;
  @ApiPropertyOptional() @IsOptional() @IsString() rootCause?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() actionPlan?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() owner?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
}

export class UpdateCapaDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: CapaStatus }) @IsOptional() @IsEnum(CapaStatus) status?: CapaStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() rootCause?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() actionPlan?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() owner?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
}
