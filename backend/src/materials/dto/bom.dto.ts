import { IsUUID, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBomItemDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty() @IsUUID() materialId: string;
  @ApiProperty({ description: 'Material quantity per 1 unit of product' }) @IsNumber() @Min(0) quantityPer: number;
  @ApiPropertyOptional({ description: 'Expected scrap %, e.g. 5 = 5%' }) @IsOptional() @IsNumber() @Min(0) scrapPct?: number;
}

export class UpdateBomItemDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) quantityPer?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) scrapPct?: number;
}
