import { IsNotEmpty, IsOptional, IsString, IsIn, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateModelDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional({ enum: ['assembly', 'quality'] })
  @IsString() @IsOptional() @IsIn(['assembly', 'quality']) modelType?: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() productId?: string;
}
