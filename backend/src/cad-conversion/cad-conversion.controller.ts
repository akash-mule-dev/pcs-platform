import {
  Controller, Post, Get, Param,
  UseGuards, UseInterceptors, UploadedFile,
  ParseFilePipe, MaxFileSizeValidator, Body,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import { CadConversionService } from './cad-conversion.service.js';
import { ModelsService } from '../models/models.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

const STAGING_DIR = path.join(os.tmpdir(), 'pcs-cad-staging');

@ApiTags('CAD Conversion')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/cad')
export class CadConversionController {
  constructor(
    private readonly cadService: CadConversionService,
    private readonly modelsService: ModelsService,
  ) {}

  @Post('convert-and-upload')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Upload a STEP/IGES CAD file, convert to GLB, and save as a 3D model' })
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
        cb(null, `${crypto.randomUUID()}${ext}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      const allowed = ['.step', '.stp', '.iges', '.igs', '.ifc'];
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowed.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`Only CAD files accepted: ${allowed.join(', ')}`), false);
      }
    },
  }))
  async convertAndUpload(
    @Body() body: { name: string; description?: string; modelType?: string; productId?: string },
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: 500 * 1024 * 1024 })], // 500MB for CAD files
    })) file: Express.Multer.File,
  ) {
    // Convert CAD to GLB
    const result = await this.cadService.convert(file.path, file.originalname);

    if (!result.success) {
      // Clean up staging file
      this.cadService.cleanup(file.path);
      throw new BadRequestException(`CAD conversion failed: ${result.error}`);
    }

    // Create a virtual multer-like file object for the converted GLB
    const glbStats = fs.statSync(result.outputPath);
    const glbFilename = `${crypto.randomUUID()}.glb`;
    const convertedFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: path.basename(file.originalname, path.extname(file.originalname)) + '.glb',
      encoding: '7bit',
      mimetype: 'model/gltf-binary',
      size: glbStats.size,
      destination: path.dirname(result.outputPath),
      filename: glbFilename,
      path: result.outputPath,
      buffer: Buffer.alloc(0),
      stream: fs.createReadStream(result.outputPath),
    };

    // Save as a 3D model using the existing models service
    const model = await this.modelsService.create(
      {
        name: body.name,
        description: body.description || `Converted from ${file.originalname}`,
        modelType: (body.modelType as 'assembly' | 'quality') || 'assembly',
        productId: body.productId,
      },
      convertedFile,
    );

    // Clean up temp files
    this.cadService.cleanup(file.path);
    this.cadService.cleanup(result.outputPath);

    return {
      ...model,
      conversion: {
        originalFormat: result.originalFormat,
        outputFormat: result.outputFormat,
        originalFile: file.originalname,
      },
    };
  }

  @Get('formats')
  @ApiOperation({ summary: 'List supported CAD formats for conversion' })
  getSupportedFormats() {
    return {
      input: [
        { extension: '.step', description: 'STEP (Standard for the Exchange of Product Data)' },
        { extension: '.stp', description: 'STEP (alternate extension)' },
        { extension: '.iges', description: 'IGES (Initial Graphics Exchange Specification)' },
        { extension: '.igs', description: 'IGES (alternate extension)' },
        { extension: '.ifc', description: 'IFC (Industry Foundation Classes - BIM coordination)' },
      ],
      output: [
        { extension: '.glb', description: 'GLB (Binary glTF)' },
      ],
    };
  }
}
