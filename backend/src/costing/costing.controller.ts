import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CostingService } from './costing.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Costing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/costing')
export class CostingController {
  constructor(private readonly service: CostingService) {}

  @Get('work-order/:id')
  @RequirePermissions('costing.view')
  @ApiOperation({ summary: 'Labor + material cost roll-up for a work order' })
  workOrder(@Param('id') id: string) {
    return this.service.workOrderCost(id);
  }
}
