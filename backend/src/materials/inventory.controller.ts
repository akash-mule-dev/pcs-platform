import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InventoryService } from './inventory.service.js';
import { ReceiveStockDto, IssueStockDto, AdjustStockDto, ScrapStockDto } from './dto/inventory.dto.js';
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
  @ApiOperation({ summary: 'Current on-hand stock' })
  stock() {
    return this.service.getStock();
  }

  @Get('movements')
  @RequirePermissions('materials.view')
  @ApiOperation({ summary: 'Stock movement ledger' })
  @ApiQuery({ name: 'materialId', required: false })
  movements(@Query('materialId') materialId?: string) {
    return this.service.getMovements(materialId);
  }

  @Get('availability')
  @RequirePermissions('materials.view')
  @ApiOperation({ summary: 'Material availability / shortage check for a planned build' })
  @ApiQuery({ name: 'productId', required: true })
  @ApiQuery({ name: 'quantity', required: true })
  availability(@Query('productId') productId: string, @Query('quantity') quantity: string) {
    return this.service.checkAvailability(productId, parseInt(quantity, 10) || 1);
  }

  @Post('receive')
  @RequirePermissions('materials.transact')
  @ApiOperation({ summary: 'Receive material into stock' })
  receive(@Body() dto: ReceiveStockDto) {
    return this.service.receive(dto);
  }

  @Post('issue')
  @RequirePermissions('materials.transact')
  @ApiOperation({ summary: 'Issue/consume material (optionally against a work order)' })
  issue(@Body() dto: IssueStockDto) {
    return this.service.issue(dto);
  }

  @Post('scrap')
  @RequirePermissions('materials.transact')
  @ApiOperation({ summary: 'Record scrapped material' })
  scrap(@Body() dto: ScrapStockDto) {
    return this.service.scrap(dto);
  }

  @Post('adjust')
  @RequirePermissions('materials.manage')
  @ApiOperation({ summary: 'Adjust on-hand stock to an absolute quantity' })
  adjust(@Body() dto: AdjustStockDto) {
    return this.service.adjust(dto);
  }
}
