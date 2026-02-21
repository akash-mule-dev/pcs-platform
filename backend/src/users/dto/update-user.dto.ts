import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional() @IsEmail() @IsOptional() email?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() firstName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() lastName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() badgeId?: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() roleId?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isActive?: boolean;
  @ApiPropertyOptional() @IsString() @IsOptional() password?: string;
}
