import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateProcessStageDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiProperty() @IsInt() targetTimeSeconds: number;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
}

export class CreateProcessDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsInt() @IsOptional() version?: number;
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional({ type: [CreateProcessStageDto] })
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => CreateProcessStageDto)
  stages?: CreateProcessStageDto[];
}
