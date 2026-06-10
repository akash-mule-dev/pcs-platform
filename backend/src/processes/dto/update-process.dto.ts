import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProcessDto {
  @ApiPropertyOptional() @IsString() @IsOptional() name?: string;
  @ApiPropertyOptional() @IsInt() @IsOptional() version?: number;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isActive?: boolean;
}
