import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InventoryService } from './inventory.service.js';
import { ReceiveStockDto, IssueStockDto, AdjustStockDto, ScrapStockDto } from './dto/inventory.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get('stock')
  @ApiOperation({ summary: 'Current on-hand stock' })
  stock() {
    return this.service.getStock();
  }

  @Get('movements')
  @ApiOperation({ summary: 'Stock movement ledger' })
  @ApiQuery({ name: 'materialId', required: false })
  movements(@Query('materialId') materialId?: string) {
    return this.service.getMovements(materialId);
  }

  @Get('availability')
  @ApiOperation({ summary: 'Material availability / shortage check for a planned build' })
  @ApiQuery({ name: 'productId', required: true })
  @ApiQuery({ name: 'quantity', required: true })
  availability(@Query('productId') productId: string, @Query('quantity') quantity: string) {
    return this.service.checkAvailability(productId, parseInt(quantity, 10) || 1);
  }

  @Post('receive')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Receive material into stock' })
  receive(@Body() dto: ReceiveStockDto) {
    return this.service.receive(dto);
  }

  @Post('issue')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Issue/consume material (optionally against a work order)' })
  issue(@Body() dto: IssueStockDto) {
    return this.service.issue(dto);
  }

  @Post('scrap')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Record scrapped material' })
  scrap(@Body() dto: ScrapStockDto) {
    return this.service.scrap(dto);
  }

  @Post('adjust')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Adjust on-hand stock to an absolute quantity' })
  adjust(@Body() dto: AdjustStockDto) {
    return this.service.adjust(dto);
  }
}
