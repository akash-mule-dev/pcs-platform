import { IsString, IsNotEmpty, IsOptional, IsEnum, IsUUID, IsObject, IsIn, IsInt, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NcrStatus, NcrSeverity, NcrDisposition } from '../entities/ncr.entity.js';

export class CreateNcrDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: NcrSeverity }) @IsOptional() @IsEnum(NcrSeverity) severity?: NcrSeverity;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
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
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: NcrStatus }) @IsOptional() @IsEnum(NcrStatus) status?: NcrStatus;
  @ApiPropertyOptional({ enum: NcrSeverity }) @IsOptional() @IsEnum(NcrSeverity) severity?: NcrSeverity;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedTo?: string;
  @ApiPropertyOptional({ enum: NcrDisposition }) @IsOptional() @IsEnum(NcrDisposition) disposition?: NcrDisposition;
  @ApiPropertyOptional() @IsOptional() @IsString() dispositionNote?: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() dataJson?: Record<string, any>;
  @ApiPropertyOptional({ description: 'Optimistic concurrency guard: the version this edit was based on (409 on mismatch)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) expectedVersion?: number;
}

/** List filters — everything optional; `open=true` means not closed/cancelled. */
export class NcrFilterDto {
  @ApiPropertyOptional({ enum: NcrStatus }) @IsOptional() @IsEnum(NcrStatus) status?: NcrStatus;
  @ApiPropertyOptional({ enum: NcrSeverity }) @IsOptional() @IsEnum(NcrSeverity) severity?: NcrSeverity;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assemblyNodeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workOrderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedTo?: string;
  @ApiPropertyOptional({ description: "'true' → only NCRs that still block gates" })
  @IsOptional() @IsIn(['true', 'false']) open?: string;
  @ApiPropertyOptional({ description: 'Search in number/title' })
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @ApiPropertyOptional({ description: 'Page size (default 500, max 1000)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
  @ApiPropertyOptional({ description: 'Rows to skip' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class NcrCommentDto {
  @ApiProperty({ description: 'Comment text for the NCR timeline' })
  @IsString() @IsNotEmpty() @MaxLength(4000) note: string;
}
