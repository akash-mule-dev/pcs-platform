import { PartialType } from '@nestjs/swagger';
import { CreateQualityDataDto } from './create-quality-data.dto.js';

export class UpdateQualityDataDto extends PartialType(CreateQualityDataDto) {}
