import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreateQualityDataDto } from './create-quality-data.dto.js';

export class BulkCreateQualityDataDto {
  @ApiProperty({ type: [CreateQualityDataDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQualityDataDto)
  items: CreateQualityDataDto[];
}
