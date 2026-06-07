import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CostingService } from './costing.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Costing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/costing')
export class CostingController {
  constructor(private readonly service: CostingService) {}

  @Get('work-order/:id')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Labor + material cost roll-up for a work order' })
  workOrder(@Param('id') id: string) {
    return this.service.workOrderCost(id);
  }
}
