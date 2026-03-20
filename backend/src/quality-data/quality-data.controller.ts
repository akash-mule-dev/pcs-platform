import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { QualityDataService } from './quality-data.service.js';
import { CreateQualityDataDto } from './dto/create-quality-data.dto.js';
import { UpdateQualityDataDto } from './dto/update-quality-data.dto.js';
import { BulkCreateQualityDataDto } from './dto/bulk-create-quality-data.dto.js';
import { PageOptionsDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@ApiTags('Quality Data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/quality-data')
export class QualityDataController {
  constructor(private readonly service: QualityDataService) {}

  @Get()
  @ApiOperation({ summary: 'List quality inspection data' })
  findAll(
    @Query() pageOptions: PageOptionsDto,
    @Query('modelId') modelId?: string,
  ) {
    return this.service.findAll(pageOptions, modelId);
  }

  // --- Static path segments MUST come before :id param routes ---

  @Get('by-model/:modelId')
  @ApiOperation({ summary: 'Get all quality data for a specific 3D model' })
  findByModel(@Param('modelId') modelId: string) {
    return this.service.findByModel(modelId);
  }

  @Get('summary/:modelId')
  @ApiOperation({ summary: 'Get quality summary (pass/fail/warning counts) for a model' })
  getSummary(@Param('modelId') modelId: string) {
    return this.service.getSummary(modelId);
  }

  @Get('trends/:modelId')
  @ApiOperation({ summary: 'Get quality trends over time for a model' })
  getTrends(@Param('modelId') modelId: string) {
    return this.service.getTrends(modelId);
  }

  @Get('defect-patterns/:modelId')
  @ApiOperation({ summary: 'Get recurring defect patterns for a model' })
  getDefectPatterns(@Param('modelId') modelId: string) {
    return this.service.getDefectPatterns(modelId);
  }

  @Get('pending-signoffs')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Get quality data pending sign-off' })
  getPendingSignoffs(@Query('modelId') modelId?: string) {
    return this.service.getPendingSignoffs(modelId);
  }

  // --- :id param route must come AFTER all static segments ---

  @Get(':id')
  @ApiOperation({ summary: 'Get quality data entry by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Create quality inspection entry' })
  create(@Body() dto: CreateQualityDataDto) {
    return this.service.create(dto);
  }

  @Post('bulk')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Bulk create quality inspection entries' })
  bulkCreate(@Body() dto: BulkCreateQualityDataDto) {
    return this.service.bulkCreate(dto);
  }

  @Patch(':id/signoff')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Sign off on a quality data entry' })
  signoff(
    @Param('id') id: string,
    @Body() body: { status: 'approved' | 'rejected'; signoffBy: string; notes?: string },
  ) {
    return this.service.signoff(id, body.status, body.signoffBy, body.notes);
  }

  @Patch(':id')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Update quality data entry' })
  update(@Param('id') id: string, @Body() dto: UpdateQualityDataDto) {
    return this.service.update(id, dto);
  }

  @Delete('by-model/:modelId')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Delete all quality data for a model' })
  removeByModel(@Param('modelId') modelId: string) {
    return this.service.removeByModel(modelId);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Delete quality data entry' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
