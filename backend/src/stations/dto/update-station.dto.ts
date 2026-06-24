import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { StationType, StationStatus } from '../station.entity.js';

export class UpdateStationDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(255) name?: string;
  @ApiPropertyOptional({ description: 'Re-parent the station to another production line (must belong to your organization).' })
  @IsUUID() @IsOptional() lineId?: string;
  @ApiPropertyOptional({ description: 'Work-center code (unique per organization).' })
  @IsString() @IsOptional() @MaxLength(100) code?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional({ enum: StationType }) @IsEnum(StationType) @IsOptional() type?: StationType;
  @ApiPropertyOptional({ enum: StationStatus }) @IsEnum(StationStatus) @IsOptional() status?: StationStatus;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Costing: machine/work-center burden rate (currency/hour). 0/empty = no machine cost.' })
  @IsNumber() @Min(0) @IsOptional() machineRate?: number;
  @ApiPropertyOptional({ description: 'Capacity basis: hours/day this work-center is staffed (utilization denominator).' })
  @IsNumber() @Min(0) @IsOptional() availableHoursPerDay?: number;
}
