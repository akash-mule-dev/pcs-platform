import {
  Controller, Get, Post, Delete,
  Param, Body, Query, Res,
  UseGuards, UseInterceptors, UploadedFile, UploadedFiles,
  ParseFilePipe, MaxFileSizeValidator, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import type { Response } from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import { CoordinationService } from './coordination.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';

const STAGING_DIR = path.join(os.tmpdir(), 'pcs-coordination-staging');

@ApiTags('Coordination Packages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager', 'supervisor')
@Controller('api/coordination')
export class CoordinationController {
  constructor(private readonly service: CoordinationService) {}

  @Get()
  @ApiOperation({ summary: 'List all coordination packages' })
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get coordination package by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/drawings')
  @ApiOperation({ summary: 'List drawings in a coordination package' })
  getDrawings(@Param('id') id: string) {
    return this.service.getDrawings(id);
  }

  @Get('drawings/:drawingId/file')
  @Public()
  @ApiOperation({ summary: 'Download a drawing PDF' })
  async downloadDrawing(@Param('drawingId') drawingId: string, @Res() res: Response) {
    try {
      const { stream, drawing } = await this.service.getDrawingFile(drawingId);
      res.set({
        'Content-Type': drawing.mimeType,
        'Content-Disposition': `inline; filename="${drawing.originalName}"`,
        'Access-Control-Expose-Headers': 'Content-Disposition',
      });
      (stream as any).pipe(res);
    } catch {
      return res.status(404).json({ message: 'Drawing not found' });
    }
  }

  @Post('upload-zip')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Upload a coordination package as ZIP (IFC + PDFs + KSS)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string' },
        description: { type: 'string' },
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
      if (ext === '.zip') {
        cb(null, true);
      } else {
        cb(new Error('Only ZIP files are accepted for coordination packages'), false);
      }
    },
  }))
  uploadZip(
    @Body() body: { name: string; description?: string },
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: 500 * 1024 * 1024 })], // 500MB
    })) file: Express.Multer.File,
  ) {
    return this.service.processZipUpload(file, body.name, body.description);
  }

  @Post('upload-files')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Upload coordination package as individual files (IFC + PDFs + KSS)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(AnyFilesInterceptor({
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });
        cb(null, STAGING_DIR);
      },
      filename: (_req, file, cb) => {
        cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
      },
    }),
  }))
  uploadFiles(
    @Body() body: { name: string; description?: string },
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const ifcFile = files.find((f) =>
      path.extname(f.originalname).toLowerCase() === '.ifc',
    );
    if (!ifcFile) {
      throw new BadRequestException('An IFC file is required in the upload');
    }

    const drawingFiles = files.filter((f) =>
      path.extname(f.originalname).toLowerCase() === '.pdf',
    );
    const kssFile = files.find((f) =>
      path.extname(f.originalname).toLowerCase() === '.kss',
    );

    return this.service.processDirectoryUpload(
      ifcFile, drawingFiles, kssFile, body.name, body.description,
    );
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete a coordination package and all associated files' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
