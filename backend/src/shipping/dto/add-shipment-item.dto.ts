import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddShipmentItemDto {
  @ApiProperty() @IsUUID() assemblyNodeId: string;
  @ApiPropertyOptional() @IsInt() @Min(1) @IsOptional() quantity?: number;
}
