import { IsBoolean, IsEmail, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional() @IsEmail() @IsOptional() email?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() mobileNo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() firstName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() lastName?: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() roleId?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isActive?: boolean;
  @ApiPropertyOptional() @IsString() @IsOptional() password?: string;
  @ApiPropertyOptional({ description: 'Costing: personal labor rate (currency/hour). 0/empty = stage/org default applies.' })
  @IsNumber() @Min(0) @IsOptional() hourlyRate?: number;
}
