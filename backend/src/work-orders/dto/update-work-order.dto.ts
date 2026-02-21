import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WorkOrderPriority } from '../work-order.entity.js';

export class UpdateWorkOrderDto {
  @ApiPropertyOptional() @IsUUID() @IsOptional() lineId?: string;
  @ApiPropertyOptional() @IsInt() @Min(1) @IsOptional() quantity?: number;
  @ApiPropertyOptional({ enum: WorkOrderPriority }) @IsEnum(WorkOrderPriority) @IsOptional() priority?: WorkOrderPriority;
  @ApiPropertyOptional() @IsOptional() dueDate?: string;
}
