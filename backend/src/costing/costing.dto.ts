import { IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCostingSettingsDto {
  @ApiPropertyOptional({ description: 'Org-wide fallback labor rate (currency/hour)' })
  @IsOptional() @IsNumber() @Min(0) defaultLaborRate?: number;

  @ApiPropertyOptional({ description: 'Shop overhead applied on labor cost, percent (0–500)' })
  @IsOptional() @IsNumber() @Min(0) @Max(500) overheadPercent?: number;

  @ApiPropertyOptional({ description: 'ISO 4217 display currency, e.g. USD / EUR / CAD / INR' })
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter ISO code' }) currency?: string;
}
