import { PartialType } from '@nestjs/swagger';
import { CreateModelDto } from './create-model.dto.js';

export class UpdateModelDto extends PartialType(CreateModelDto) {}
