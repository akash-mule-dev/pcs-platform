import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WorkOrderStatus } from '../work-order.entity.js';

export class UpdateStatusDto {
  @ApiProperty({ enum: WorkOrderStatus })
  @IsEnum(WorkOrderStatus)
  status: WorkOrderStatus;
}
