import { IsString, IsOptional, IsInt, IsUUID, IsIn, Min, IsDateString, IsArray, ArrayNotEmpty, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductionOrderDto {
  @ApiProperty({ description: 'Process (routing) for this order — its stages are materialized per assembly' })
  @IsUUID() processId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerName?: string;
  @ApiPropertyOptional({ description: 'How many copies of the project this order builds', default: 1 })
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateProductionOrderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() customerName?: string;
  @ApiPropertyOptional({ enum: ['planned', 'in_progress', 'completed', 'cancelled'] })
  @IsOptional() @IsIn(['planned', 'in_progress', 'completed', 'cancelled']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class SetStageProgressDto {
  @ApiPropertyOptional({ description: 'Units completed at this stage (clamped to the stage total)' })
  @IsOptional() @IsInt() @Min(0) qtyDone?: number;
  @ApiPropertyOptional({ enum: ['pending', 'in_progress', 'completed', 'skipped'], description: 'Set status directly (for qty=1 or skip)' })
  @IsOptional() @IsIn(['pending', 'in_progress', 'completed', 'skipped']) status?: string;
  @ApiPropertyOptional({ enum: ['web', 'mobile', 'api'], description: 'Recorded on the audit trail' })
  @IsOptional() @IsIn(['web', 'mobile', 'api']) source?: string;
}

/** Batch update: apply ONE stage change to MANY assemblies of the same order. */
export class BulkStageUpdateDto {
  @ApiProperty({ description: 'The process stage to update on every selected assembly' })
  @IsUUID() stageId: string;

  @ApiProperty({ description: 'Assembly node ids (each maps to its per-assembly work order in this order)', type: [String] })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(1000) @IsUUID('all', { each: true }) nodeIds: string[];

  @ApiPropertyOptional({ description: 'Units completed at this stage (clamped per assembly to its stage total)' })
  @IsOptional() @IsInt() @Min(0) qtyDone?: number;

  @ApiPropertyOptional({ enum: ['pending', 'in_progress', 'completed', 'skipped'] })
  @IsOptional() @IsIn(['pending', 'in_progress', 'completed', 'skipped']) status?: string;

  @ApiPropertyOptional({ enum: ['web', 'mobile', 'api'], description: 'Recorded on the audit trail' })
  @IsOptional() @IsIn(['web', 'mobile', 'api']) source?: string;
}
