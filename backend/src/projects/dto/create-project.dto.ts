import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsString() @IsOptional() projectNumber?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() clientName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
}
