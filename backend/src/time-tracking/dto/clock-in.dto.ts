import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputMethod } from '../time-entry.entity.js';

export class ClockInDto {
  @ApiProperty() @IsUUID() workOrderStageId: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() stationId?: string;
  @ApiPropertyOptional({ enum: InputMethod }) @IsEnum(InputMethod) @IsOptional() inputMethod?: InputMethod;
  /** Setup time (machine/fixture set-up) rather than run time — costed in the setup bucket. */
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isSetup?: boolean;
}
