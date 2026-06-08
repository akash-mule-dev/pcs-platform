import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards,
  UseInterceptors, UploadedFile, Res, ParseFilePipe, MaxFileSizeValidator, ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import type { Response } from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import { QualityDataService } from './quality-data.service.js';
import { CreateQualityDataDto } from './dto/create-quality-data.dto.js';
import { UpdateQualityDataDto } from './dto/update-quality-data.dto.js';
import { BulkCreateQualityDataDto } from './dto/bulk-create-quality-data.dto.js';
import { PageOptionsDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

// Temp staging dir for multipart evidence uploads; the storage provider moves
// the file to its final destination (mirrors ModelsController's thumbnail flow).
const STAGING_DIR = path.join(os.tmpdir(), 'pcs-uploads');

@ApiTags('Quality Data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager', 'supervisor')
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

  @Get('summary-batch')
  @ApiOperation({ summary: 'Batch quality summary for multiple models (?modelIds=a,b,c)' })
  getSummaryBatch(@Query('modelIds') modelIds?: string) {
    const ids = (modelIds || '').split(',').map((s) => s.trim()).filter(Boolean);
    return this.service.getSummaryBatch(ids);
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

  @Post(':id/evidence')
  @Roles('admin', 'manager', 'supervisor')
  @ApiOperation({ summary: 'Attach a captured evidence image (e.g. AR snapshot) to a quality entry' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });
        cb(null, STAGING_DIR);
      },
      filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname) || '.jpg'}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  addEvidence(
    @Param('id') id: string,
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 })],
    })) file: Express.Multer.File,
  ) {
    return this.service.addEvidence(id, file);
  }

  @Get(':id/evidence/:index')
  @ApiOperation({ summary: 'Stream a stored evidence image by index' })
  async getEvidence(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Res() res: Response,
  ) {
    try {
      const { stream, key } = await this.service.getEvidenceStream(id, index);
      const ext = path.extname(key).toLowerCase();
      const type = ext === '.png' ? 'image/png' : 'image/jpeg';
      res.set({ 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' });
      (stream as any).pipe(res);
    } catch {
      return res.status(404).json({ message: 'Evidence not found' });
    }
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
