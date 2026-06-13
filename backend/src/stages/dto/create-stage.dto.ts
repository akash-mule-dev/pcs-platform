import { IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStageDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiProperty() @IsInt() sequence: number;
  @ApiProperty() @IsInt() targetTimeSeconds: number;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional({ description: 'Hold point: stage needs a recorded inspection to complete' })
  @IsBoolean() @IsOptional() requiresInspection?: boolean;
  @ApiPropertyOptional({ description: 'Costing: standard labor rate for this stage (currency/hour). 0/empty = org default.' })
  @IsNumber() @Min(0) @IsOptional() hourlyRate?: number;
}
