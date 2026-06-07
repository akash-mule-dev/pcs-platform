import { IsString, IsNotEmpty, IsOptional, IsEnum, IsObject, IsInt, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { TemplateType } from '../entities/form-template.entity.js';

export class CreateTemplateDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiProperty({ enum: TemplateType }) @IsEnum(TemplateType) type: TemplateType;
  @ApiPropertyOptional({ type: Object, description: 'Form.io / JSON form definition' }) @IsOptional() @IsObject() schema?: Record<string, any>;
  @ApiPropertyOptional() @IsOptional() @IsInt() version?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateTemplateDto extends PartialType(CreateTemplateDto) {}
