import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateStageDto {
  @ApiPropertyOptional() @IsString() @IsOptional() name?: string;
  @ApiPropertyOptional() @IsInt() @IsOptional() sequence?: number;
  @ApiPropertyOptional() @IsInt() @IsOptional() targetTimeSeconds?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Hold point: stage needs a recorded inspection to complete' })
  @IsBoolean() @IsOptional() requiresInspection?: boolean;
  @ApiPropertyOptional({ description: 'Costing: standard labor rate for this stage (currency/hour). 0/empty = org default.' })
  @IsNumber() @Min(0) @IsOptional() hourlyRate?: number;
  @ApiPropertyOptional({ description: 'Costing: planned machine seconds per unit at this stage (machine estimate). 0 = no machine.' })
  @IsInt() @Min(0) @IsOptional() machineTimeSeconds?: number;
  @ApiPropertyOptional({ description: 'Costing: standard machine rate for this stage (currency/hour). 0/empty = no machine cost.' })
  @IsNumber() @Min(0) @IsOptional() machineRate?: number;
  @ApiPropertyOptional({ description: 'Costing: overhead % on this stage’s labor. Empty = org default; 0 = no overhead.' })
  @IsNumber() @Min(0) @IsOptional() overheadPercent?: number;
}
