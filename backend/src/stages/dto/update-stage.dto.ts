import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateStageDto {
  @ApiPropertyOptional() @IsString() @IsOptional() name?: string;
  @ApiPropertyOptional() @IsInt() @IsOptional() sequence?: number;
  @ApiPropertyOptional() @IsInt() @IsOptional() targetTimeSeconds?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isActive?: boolean;
}
