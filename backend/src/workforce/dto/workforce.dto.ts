import { IsString, IsNotEmpty, IsOptional, IsUUID, IsEnum, IsArray, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AttendanceStatus } from '../entities/attendance.entity.js';

export class CreateSkillDto {
  @ApiProperty() @IsString() @IsNotEmpty() code: string;
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}
export class UpdateSkillDto extends PartialType(CreateSkillDto) {}

export class AssignSkillDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty() @IsUUID() skillId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() level?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() certifiedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class CreateShiftDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiProperty({ description: 'HH:mm' }) @IsString() startTime: string;
  @ApiProperty({ description: 'HH:mm' }) @IsString() endTime: string;
  @ApiPropertyOptional({ type: [String], description: "Day numbers '1'..'7' (Mon..Sun)" }) @IsOptional() @IsArray() daysOfWeek?: string[];
}
export class UpdateShiftDto extends PartialType(CreateShiftDto) {}

export class AssignShiftDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty() @IsUUID() shiftId: string;
  @ApiProperty() @IsDateString() effectiveFrom: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
}

export class RecordAttendanceDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty({ description: 'YYYY-MM-DD' }) @IsDateString() date: string;
  @ApiPropertyOptional({ enum: AttendanceStatus }) @IsOptional() @IsEnum(AttendanceStatus) status?: AttendanceStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
