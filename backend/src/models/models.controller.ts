import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards,
  UseInterceptors, UploadedFile, Res, ParseFilePipe, MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import type { Response } from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
// Lazy-loaded: these are heavy WASM packages only needed for AR file processing
let _NodeIO: any;
let _normals: any;
async function getGltfTransform() {
  if (!_NodeIO) {
    const core = await import('@gltf-transform/core');
    const functions = await import('@gltf-transform/functions');
    _NodeIO = core.NodeIO;
    _normals = functions.normals;
  }
  return { NodeIO: _NodeIO, normals: _normals };
}
import { ModelsService } from './models.service.js';
import { CreateModelDto } from './dto/create-model.dto.js';
import { UpdateModelDto } from './dto/update-model.dto.js';
import { PageOptionsDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';

// Use a temp directory for multer staging; storage provider handles final destination
const STAGING_DIR = path.join(os.tmpdir(), 'pcs-uploads');

@ApiTags('3D Models')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/models')
export class ModelsController {
  constructor(private readonly service: ModelsService) {}

  @Get()
  @ApiOperation({ summary: 'List 3D models' })
  findAll(
    @Query() pageOptions: PageOptionsDto,
    @Query('modelType') modelType?: string,
  ) {
    return this.service.findAll(pageOptions, modelType);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get 3D model by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/file')
  @Public()
  @ApiOperation({ summary: 'Download 3D model file (public — no auth required)' })
  async downloadFile(@Param('id') id: string, @Res() res: Response) {
    try {
      const { stream, model } = await this.service.getFileStream(id);
      res.set({
        'Content-Type': model.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${model.originalName}"`,
        'Access-Control-Expose-Headers': 'Content-Disposition',
      });
      (stream as any).pipe(res);
    } catch {
      return res.status(404).json({ message: 'File not found' });
    }
  }

  @Get(':id/file/ar')
  @Public()
  @ApiOperation({ summary: 'Download AR-compatible GLB (with tangents for Viro renderer)' })
  async downloadARFile(@Param('id') id: string, @Res() res: Response) {
    try {
      const { stream, model } = await this.service.getFileStream(id);

      const ext = path.extname(model.originalName).toLowerCase();
      if (ext !== '.glb') {
        // Non-GLB: stream as-is
        res.set({
          'Content-Type': model.mimeType || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${model.originalName}"`,
        });
        return (stream as any).pipe(res);
      }

      // Buffer the GLB stream, add tangents, and send the processed file
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      const glbBuffer = Buffer.concat(chunks);

      const { NodeIO, normals } = await getGltfTransform();
      const io = new NodeIO();
      const doc = await io.readBinary(new Uint8Array(glbBuffer));
      await doc.transform(normals());
      const processedGlb = await io.writeBinary(doc);

      res.set({
        'Content-Type': 'model/gltf-binary',
        'Content-Disposition': `inline; filename="${model.originalName}"`,
        'Content-Length': String(processedGlb.byteLength),
      });
      res.send(Buffer.from(processedGlb));
    } catch (err) {
      console.error('AR file processing error:', err);
      return res.status(404).json({ message: 'File not found or processing failed' });
    }
  }

  @Post()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Upload a 3D model' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string' },
        description: { type: 'string' },
        modelType: { type: 'string', enum: ['assembly', 'quality'] },
        productId: { type: 'string' },
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
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueName = `${crypto.randomUUID()}${ext}`;
        cb(null, uniqueName);
      },
    }),
    fileFilter: (_req, file, cb) => {
      const allowed = ['.glb', '.gltf', '.obj', '.fbx', '.stl', '.step', '.stp', '.iges', '.igs', '.ifc'];
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowed.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`File type ${ext} not allowed. Supported: ${allowed.join(', ')}`), false);
      }
    },
  }))
  create(
    @Body() dto: CreateModelDto,
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: 500 * 1024 * 1024 })], // 500MB for IFC/CAD files
    })) file: Express.Multer.File,
  ) {
    return this.service.create(dto, file);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Update 3D model metadata' })
  update(@Param('id') id: string, @Body() dto: UpdateModelDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete 3D model' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
