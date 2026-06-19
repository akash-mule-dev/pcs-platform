import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Min, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Correct an existing time entry. Any of the fields below may be changed,
 * including reassigning the worker / stage / station — when the assignment
 * changes (or the entry had no frozen rate yet) the service re-resolves and
 * re-freezes the labor + machine rates so costing follows the correction.
 */
export class UpdateTimeEntryDto {
  /** Reassign the worker the time is attributed to. */
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;

  /** Move the entry to a different work-order stage (e.g. logged on the wrong stage). */
  @ApiPropertyOptional() @IsOptional() @IsUUID() workOrderStageId?: string;

  /** Reassign (or clear, with null) the station. */
  @ApiPropertyOptional() @ValidateIf((o) => o.stationId !== undefined) @IsOptional() @ValidateIf((o) => o.stationId !== null) @IsUUID() stationId?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsDateString() startTime?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString() endTime?: string;

  /** Override the worked duration directly (seconds). */
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) durationSeconds?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) breakSeconds?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) idleSeconds?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isSetup?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRework?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
