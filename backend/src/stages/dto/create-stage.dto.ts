import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStageDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiProperty() @IsInt() sequence: number;
  @ApiProperty() @IsInt() targetTimeSeconds: number;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
}
