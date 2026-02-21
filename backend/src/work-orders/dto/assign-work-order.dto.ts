import { IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignmentDto {
  @ApiProperty() @IsUUID() stageId: string;
  @ApiProperty() @IsUUID() userId: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() stationId?: string;
}

export class AssignWorkOrderDto {
  @ApiProperty({ type: [AssignmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssignmentDto)
  assignments: AssignmentDto[];
}
