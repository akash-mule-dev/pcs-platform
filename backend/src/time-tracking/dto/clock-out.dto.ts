import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClockOutDto {
  @ApiProperty() @IsUUID() timeEntryId: string;
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;
}
