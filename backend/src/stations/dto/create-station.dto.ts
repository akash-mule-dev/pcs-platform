import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStationDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiProperty() @IsUUID() lineId: string;
  @ApiPropertyOptional({ description: 'Costing: machine/work-center burden rate (currency/hour). 0/empty = no machine cost.' })
  @IsNumber() @Min(0) @IsOptional() machineRate?: number;
}
