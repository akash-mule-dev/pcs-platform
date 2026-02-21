import { IsInt, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTimeEntryDto {
  @ApiPropertyOptional() @IsOptional() startTime?: string;
  @ApiPropertyOptional() @IsOptional() endTime?: string;
  @ApiPropertyOptional() @IsInt() @IsOptional() breakSeconds?: number;
  @ApiPropertyOptional() @IsInt() @IsOptional() idleSeconds?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;
}
