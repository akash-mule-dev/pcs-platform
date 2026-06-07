import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertPermissionDto {
  @ApiProperty() @IsString() @IsNotEmpty() role: string;
  @ApiProperty() @IsString() @IsNotEmpty() feature: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() canView?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() canManage?: boolean;
}
