import { IsEmail, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Editable company profile (stored under organizations.settings.profile). */
export class CompanyProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) legalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() contactEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) website?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) addressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) addressLine2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) taxId?: string;
}

/** Self-service company update — name/description/profile only (never slug/kind/active). */
export class UpdateCompanyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;

  @ApiPropertyOptional({ type: CompanyProfileDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyProfileDto)
  profile?: CompanyProfileDto;
}
