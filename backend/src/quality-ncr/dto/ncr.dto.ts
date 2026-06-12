import { IsString, IsNotEmpty, IsOptional, IsEnum, IsUUID, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NcrStatus, NcrSeverity, NcrDisposition } from '../entities/ncr.entity.js';

export class CreateNcrDto {
  @ApiProperty() @IsString() @IsNotEmpty() title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: NcrSeverity }) @IsOptional() @IsEnum(NcrSeverity) severity?: NcrSeverity;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() materialId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() serialId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() templateId?: string;
  @ApiPropertyOptional({ type: Object, description: 'Form data captured against the template' }) @IsOptional() @IsObject() dataJson?: Record<string, any>;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assemblyNodeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() qualityDataId?: string;
}

export class UpdateNcrDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: NcrStatus }) @IsOptional() @IsEnum(NcrStatus) status?: NcrStatus;
  @ApiPropertyOptional({ enum: NcrSeverity }) @IsOptional() @IsEnum(NcrSeverity) severity?: NcrSeverity;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedTo?: string;
  @ApiPropertyOptional({ enum: NcrDisposition }) @IsOptional() @IsEnum(NcrDisposition) disposition?: NcrDisposition;
  @ApiPropertyOptional() @IsOptional() @IsString() dispositionNote?: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() dataJson?: Record<string, any>;
}
