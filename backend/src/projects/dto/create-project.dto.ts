import { IsNotEmpty, IsOptional, IsString, IsEnum, IsDateString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectStatus } from '../project.entity.js';

export class CreateProjectDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsString() @IsOptional() projectNumber?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() clientName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional({ enum: ProjectStatus }) @IsEnum(ProjectStatus) @IsOptional() status?: ProjectStatus;
  @ApiPropertyOptional() @IsDateString() @IsOptional() dueDate?: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() processId?: string;
}
