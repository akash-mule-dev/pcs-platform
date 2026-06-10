import { IsString, IsOptional, IsInt, IsUUID, IsIn, Min, IsDateString } from 'class-validator';
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
}
