import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { StationStatus } from '../station.entity.js';

/** Body for PATCH /stations/:id/status — the operate action (set the operational state). */
export class StationStatusDto {
  @ApiProperty({ enum: StationStatus }) @IsEnum(StationStatus) status: StationStatus;
}
