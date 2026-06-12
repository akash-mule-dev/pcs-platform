import {
  Controller, Post, Get, Param, Body, Req,
  UseGuards, UseInterceptors, UploadedFile, UploadedFiles,
  ParseFilePipe, MaxFileSizeValidator, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import { ConversionService } from './conversion.service.js';
import { CreateConversionDto } from './dto/create-conversion.dto.js';
import { SUPPORTED_INPUT_EXTS, SUPPORTED_FORMATS } from './converters/converter.registry.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

const STAGING_DIR = path.join(os.tmpdir(), 'pcs-conversion-staging');

function parseBool(value: unknown, def: boolean): boolean {
  if (value === undefined || value === null || value === '') return def;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

@ApiTags('Conversion')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/conversion')
export class ConversionController {
  constructor(private readonly service: ConversionService) {}

  @Post('convert')
  @RequirePermissions('coordination.convert')
  @ApiOperation({
    summary: 'Upload any supported 3D file; convert + optimize to GLB asynchronously',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string' },
        description: { type: 'string' },
        modelType: { type: 'string', enum: ['assembly', 'quality'] },
        optimize: { type: 'boolean', default: true },
        simplifyRatio: { type: 'number', description: '0 < r <= 1 (1 = no decimation)' },
        draco: { type: 'boolean', default: false },
        quantize: { type: 'boolean', default: false },
      },
      required: ['file', 'name'],
    },
  })
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });
        cb(null, STAGING_DIR);
      },
      filename: (_req, file, cb) => {
        cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (SUPPORTED_INPUT_EXTS.includes(ext)) cb(null, true);
      else cb(new Error(`Unsupported format. Accepted: ${SUPPORTED_INPUT_EXTS.join(', ')}`), false);
    },
  }))
  async convert(
    @Body() body: Record<string, string>,
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: 500 * 1024 * 1024 })], // 500MB
    })) file: Express.Multer.File,
    @Req() req: any,
  ) {
    const dto: CreateConversionDto = {
      name: body.name,
      description: body.description,
      modelType: body.modelType as 'assembly' | 'quality' | undefined,
      optimize: parseBool(body.optimize, true),
      simplifyRatio: body.simplifyRatio !== undefined ? Number(body.simplifyRatio) : undefined,
      draco: parseBool(body.draco, false),
      quantize: parseBool(body.quantize, false),
      sourceUnit: body.sourceUnit || undefined,
      upAxis: (body.upAxis as 'Y' | 'Z') || undefined,
    };
    const userId = req?.user?.id || req?.user?.sub || req?.user?.userId;
    const job = await this.service.createJob(dto, file, userId);
    return {
      jobId: job.id,
      status: job.status,
      sourceFormat: job.sourceFormat,
      message: 'Conversion queued. Subscribe to "conversion:progress" or poll GET /api/conversion/:id.',
    };
  }

  @Post('convert-batch')
  @RequirePermissions('coordination.convert')
  @ApiOperation({ summary: 'Upload multiple 3D files and/or ZIP archives; convert each to GLB' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        modelType: { type: 'string', enum: ['assembly', 'quality'] },
        optimize: { type: 'boolean', default: true },
        simplifyRatio: { type: 'number' },
        draco: { type: 'boolean', default: false },
        sourceUnit: { type: 'string' },
        upAxis: { type: 'string', enum: ['Y', 'Z'] },
      },
      required: ['files'],
    },
  })
  @UseInterceptors(FilesInterceptor('files', 200, {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });
        cb(null, STAGING_DIR);
      },
      filename: (_req, file, cb) => {
        cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (SUPPORTED_INPUT_EXTS.includes(ext) || ext === '.zip') cb(null, true);
      else cb(new Error(`Unsupported file: ${ext}`), false);
    },
    limits: { fileSize: 500 * 1024 * 1024 },
  }))
  async convertBatch(
    @Body() body: Record<string, string>,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any,
  ) {
    if (!files || files.length === 0) throw new BadRequestException('No files uploaded');
    const dto: CreateConversionDto = {
      name: '',
      modelType: body.modelType as 'assembly' | 'quality' | undefined,
      optimize: parseBool(body.optimize, true),
      simplifyRatio: body.simplifyRatio !== undefined ? Number(body.simplifyRatio) : undefined,
      draco: parseBool(body.draco, false),
      quantize: parseBool(body.quantize, false),
      sourceUnit: body.sourceUnit || undefined,
      upAxis: (body.upAxis as 'Y' | 'Z') || undefined,
    };
    const userId = req?.user?.id || req?.user?.sub || req?.user?.userId;
    const jobs = await this.service.createBatch(files, dto, userId);
    return {
      count: jobs.length,
      jobs: jobs.map((j) => ({ id: j.id, originalName: j.originalName, status: j.status })),
    };
  }

  @Post(':id/retry')
  @RequirePermissions('coordination.convert')
  @ApiOperation({ summary: 'Re-run a conversion job (e.g. after a failure)' })
  async retry(@Param('id') id: string) {
    const job = await this.service.retry(id);
    return { jobId: job.id, status: job.status };
  }

  @Get()
  @ApiOperation({ summary: 'List recent conversion jobs' })
  async list() {
    const jobs = await this.service.findAll();
    return jobs.map((j) => ({
      id: j.id,
      status: j.status,
      progress: j.progress,
      originalName: j.originalName,
      sourceFormat: j.sourceFormat,
      modelId: j.modelId,
      outputSize: j.outputSize,
      trianglesBefore: j.trianglesBefore,
      trianglesAfter: j.trianglesAfter,
      dimensions: j.dimensions,
      error: j.error,
      createdAt: j.createdAt,
    }));
  }

  @Get('formats')
  @ApiOperation({ summary: 'List supported input formats' })
  getFormats() {
    return {
      input: SUPPORTED_FORMATS,
      output: [{ extension: '.glb', description: 'GLB (Binary glTF) — optimized for AR/web/app' }],
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversion job status' })
  async getJob(@Param('id') id: string) {
    const job = await this.service.findOne(id);
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      originalName: job.originalName,
      sourceFormat: job.sourceFormat,
      modelId: job.modelId,
      outputSize: job.outputSize,
      trianglesBefore: job.trianglesBefore,
      trianglesAfter: job.trianglesAfter,
      dimensions: job.dimensions,
      error: job.error,
      durationMs: job.durationMs,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
