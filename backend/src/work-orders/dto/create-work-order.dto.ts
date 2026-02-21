import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkOrderPriority } from '../work-order.entity.js';

export class CreateWorkOrderDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty() @IsUUID() processId: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() lineId?: string;
  @ApiProperty() @IsInt() @Min(1) quantity: number;
  @ApiPropertyOptional({ enum: WorkOrderPriority }) @IsEnum(WorkOrderPriority) @IsOptional() priority?: WorkOrderPriority;
  @ApiPropertyOptional() @IsOptional() dueDate?: string;
}
