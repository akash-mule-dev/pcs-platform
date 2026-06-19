import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9 _-]{1,48}$/;
const NAME_MESSAGE =
  'Role name must be 2-49 characters: letters, numbers, spaces, hyphens or underscores, starting with a letter or number';

export class CreateRoleDto {
  @ApiProperty({ example: 'QC Inspector' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(49)
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  name: string;

  @ApiPropertyOptional({ example: 'Can record inspections and raise NCRs' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    description: 'Fine-grained permission keys from the catalog, e.g. ["work-orders.view", "quality-reports.create"]',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'A role needs at least one permission' })
  @IsString({ each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(49)
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: 'A role needs at least one permission' })
  @IsString({ each: true })
  permissions?: string[];
}

export class DuplicateRoleDto {
  @ApiProperty({ example: 'QC Inspector (Night Shift)' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(49)
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
