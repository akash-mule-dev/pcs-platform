import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InventoryService } from './inventory.service.js';
import { ReceiveStockDto, IssueStockDto, ReturnStockDto, AdjustStockDto, ScrapStockDto } from './dto/inventory.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

@ApiTags('Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get('stock')
  @RequirePermissions('materials.view')
  @ApiOperation({ summary: 'Current on-hand stock (raw rows per material+location)' })
  stock() {
    return this.service.getStock();
  }

  @Get('summary')
  @RequirePermissions('materials.view')
  @ApiOperation({ summary: 'Inventory overview: every material with on-hand, moving-average cost, value and low-stock flag' })
  summary() {
    return this.service.getSummary();
  }

  @Get('movements')
  @RequirePermissions('materials.view')
  @ApiOperation({ summary: 'Stock movement ledger (filter by material / production order / work order)' })
  @ApiQuery({ name: 'materialId', required: false })
  @ApiQuery({ name: 'productionOrderId', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  movements(
    @Query('materialId') materialId?: string,
    @Query('productionOrderId') productionOrderId?: string,
    @Query('workOrderId') workOrderId?: string,
  ) {
    return this.service.getMovements({ materialId, productionOrderId, workOrderId });
  }

  @Post('receive')
  @RequirePermissions('materials.transact')
  @ApiOperation({ summary: 'Receive material into stock (unit cost re-averages the moving-average cost)' })
  receive(@Body() dto: ReceiveStockDto) {
    return this.service.receive(dto);
  }

  @Post('issue')
  @RequirePermissions('materials.transact')
  @ApiOperation({ summary: 'Issue material to production (optionally against a production order / work order)' })
  issue(@Body() dto: IssueStockDto) {
    return this.service.issue(dto);
  }

  @Post('return')
  @RequirePermissions('materials.transact')
  @ApiOperation({ summary: 'Return previously issued material to stock' })
  returnStock(@Body() dto: ReturnStockDto) {
    return this.service.returnStock(dto);
  }

  @Post('scrap')
  @RequirePermissions('materials.transact')
  @ApiOperation({ summary: 'Record scrapped material (costed like an issue)' })
  scrap(@Body() dto: ScrapStockDto) {
    return this.service.scrap(dto);
  }

  @Post('adjust')
  @RequirePermissions('materials.manage')
  @ApiOperation({ summary: 'Adjust on-hand stock to an absolute quantity (count correction)' })
  adjust(@Body() dto: AdjustStockDto) {
    return this.service.adjust(dto);
  }
}
