import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateProcessStageDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiProperty() @IsInt() targetTimeSeconds: number;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  /** ITP intent — a 'hold' point gates on this stage's own NCRs/inspection. */
  @ApiPropertyOptional({ enum: ['hold', 'witness', 'review'] })
  @IsString() @IsOptional() @IsIn(['hold', 'witness', 'review']) inspectionType?: 'hold' | 'witness' | 'review';
  @ApiPropertyOptional() @IsBoolean() @IsOptional() requiresInspection?: boolean;
  /** Mark this stage as the terminal final-QC / release gate (suppresses auto-append). */
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isFinalQc?: boolean;
}

export class CreateProcessDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsInt() @IsOptional() version?: number;
  @ApiPropertyOptional({ type: [CreateProcessStageDto] })
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => CreateProcessStageDto)
  stages?: CreateProcessStageDto[];
  /**
   * Auto-append the default terminal Final QC release stage (default true).
   * Skipped when any supplied stage is already flagged `isFinalQc`.
   */
  @ApiPropertyOptional() @IsBoolean() @IsOptional() appendFinalQc?: boolean;
}
