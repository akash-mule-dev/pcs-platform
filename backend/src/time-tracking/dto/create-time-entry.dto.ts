import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputMethod } from '../time-entry.entity.js';

/**
 * Manually log a time record against a work-order stage (retroactive entry or a
 * supervisor correction), as opposed to a live clock-in/out. The worker is
 * explicit (managers log on behalf of operators), and the duration may be given
 * directly OR derived from start/end. Labor + machine rates are frozen by the
 * service exactly as they are at clock-out, so costing stays consistent.
 */
export class CreateTimeEntryDto {
  /** The worker the time is attributed to (managers log on behalf of operators). */
  @ApiProperty() @IsUUID() userId: string;

  /** The work-order stage the time was spent on (ties the entry to assembly + stage). */
  @ApiProperty() @IsUUID() workOrderStageId: string;

  @ApiPropertyOptional() @ValidateIf((o) => o.stationId !== null && o.stationId !== undefined) @IsUUID() stationId?: string | null;

  @ApiProperty() @IsDateString() startTime: string;

  /** End time — when given, duration is derived from end − start (overrides durationSeconds). */
  @ApiPropertyOptional() @IsOptional() @IsDateString() endTime?: string;

  /** Explicit worked duration in seconds (used when no endTime is supplied). */
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) durationSeconds?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) breakSeconds?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) idleSeconds?: number;

  /** Setup time (machine/fixture set-up) rather than run time — costed in the setup bucket. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isSetup?: boolean;

  /** Rework (cost of quality) rather than first-pass run time. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRework?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;

  @ApiPropertyOptional({ enum: InputMethod }) @IsOptional() @IsEnum(InputMethod) inputMethod?: InputMethod;
}
