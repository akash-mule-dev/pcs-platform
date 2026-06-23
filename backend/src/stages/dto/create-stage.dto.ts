import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStageDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiProperty() @IsInt() sequence: number;
  @ApiProperty() @IsInt() targetTimeSeconds: number;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional({ description: 'Hold point: stage needs a recorded inspection to complete' })
  @IsBoolean() @IsOptional() requiresInspection?: boolean;
  @ApiPropertyOptional({ description: 'ITP intent: hold (blocks) | witness | review. Null = not an inspection point.' })
  @IsIn(['hold', 'witness', 'review']) @IsOptional() inspectionType?: 'hold' | 'witness' | 'review';
  @ApiPropertyOptional({ description: 'Terminal final-QC / release gate: consolidates every stage’s QC. Blocked while ANY NCR is open.' })
  @IsBoolean() @IsOptional() isFinalQc?: boolean;
  @ApiPropertyOptional({ description: 'ITP line detail: what to verify + acceptance criteria (free-form).' })
  @IsObject() @IsOptional() inspectionCharacteristics?: Record<string, any>;
  @ApiPropertyOptional({ description: 'Role required to sign this inspection point (e.g. cwi, qa_manager).' })
  @IsString() @IsOptional() requiredSignoffRole?: string;
  @ApiPropertyOptional({ description: 'Costing: standard labor rate for this stage (currency/hour). 0/empty = org default.' })
  @IsNumber() @Min(0) @IsOptional() hourlyRate?: number;
  @ApiPropertyOptional({ description: 'Costing: planned machine seconds per unit at this stage (machine estimate). 0 = no machine.' })
  @IsInt() @Min(0) @IsOptional() machineTimeSeconds?: number;
  @ApiPropertyOptional({ description: 'Costing: standard machine rate for this stage (currency/hour). 0/empty = no machine cost.' })
  @IsNumber() @Min(0) @IsOptional() machineRate?: number;
  @ApiPropertyOptional({ description: 'Costing: overhead % on this stage’s labor. Empty = org default; 0 = no overhead.' })
  @IsNumber() @Min(0) @IsOptional() overheadPercent?: number;
}
