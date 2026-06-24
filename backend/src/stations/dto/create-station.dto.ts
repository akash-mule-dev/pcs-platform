import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StationType, StationStatus } from '../station.entity.js';

export class CreateStationDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) name: string;
  @ApiProperty() @IsUUID() lineId: string;
  @ApiPropertyOptional({ description: 'Work-center code (unique per organization), e.g. "WELD-3".' })
  @IsString() @IsOptional() @MaxLength(100) code?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional({ enum: StationType }) @IsEnum(StationType) @IsOptional() type?: StationType;
  @ApiPropertyOptional({ enum: StationStatus }) @IsEnum(StationStatus) @IsOptional() status?: StationStatus;
  @ApiPropertyOptional({ description: 'Costing: machine/work-center burden rate (currency/hour). 0/empty = no machine cost.' })
  @IsNumber() @Min(0) @IsOptional() machineRate?: number;
  @ApiPropertyOptional({ description: 'Capacity basis: hours/day this work-center is staffed (utilization denominator). Empty = no utilization %.' })
  @IsNumber() @Min(0) @IsOptional() availableHoursPerDay?: number;
}
