import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty() @IsString() @IsNotEmpty() employeeId: string;
  @ApiPropertyOptional() @IsEmail() @IsOptional() email?: string;
  @ApiProperty() @IsString() @IsNotEmpty() mobileNo: string;
  @ApiProperty() @IsString() @MinLength(6) password: string;
  @ApiProperty() @IsString() @IsNotEmpty() firstName: string;
  @ApiProperty() @IsString() @IsNotEmpty() lastName: string;
  @ApiProperty() @IsUUID() roleId: string;
  @ApiPropertyOptional({ description: "Tenant the user belongs to. Defaults to the creator's organization." }) @IsOptional() @IsUUID() organizationId?: string;
}
