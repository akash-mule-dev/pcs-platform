import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Res,
  UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator, ParseIntPipe, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import type { Response } from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import { QualityNcrService } from './quality-ncr.service.js';
import { CreateNcrDto, UpdateNcrDto, NcrFilterDto, NcrCommentDto } from './dto/ncr.dto.js';
import { ncrNextStatuses } from './ncr-workflow.js';
import { EVIDENCE_EXTENSIONS, EVIDENCE_MIME_TYPES, EVIDENCE_MAX_BYTES, evidenceContentType } from '../quality-data/evidence.constants.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';

// Temp staging dir for multipart evidence uploads (mirrors quality-data's flow).
const STAGING_DIR = path.join(os.tmpdir(), 'pcs-uploads');

@ApiTags('NCR')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/ncr')
export class NcrController {
  constructor(private readonly service: QualityNcrService) {}

  @Get()
  @RequirePermissions('ncr.view')
  @ApiOperation({ summary: 'List NCRs (filter by status/severity/project/item/work order/assignee/open/q)' })
  list(@Query() filter: NcrFilterDto) {
    return this.service.listNcr(filter);
  }

  @Get(':id')
  @RequirePermissions('ncr.view')
  @ApiOperation({ summary: 'An NCR with its legal next statuses (drives guided transition UIs)' })
  async findOne(@Param('id') id: string) {
    const ncr = await this.service.getNcr(id);
    return { ...ncr, allowedTransitions: ncrNextStatuses(ncr.status) };
  }

  @Get(':id/events')
  @RequirePermissions('ncr.view')
  @ApiOperation({ summary: 'NCR timeline: creation, transitions, dispositions, assignments, comments' })
  events(@Param('id') id: string) {
    return this.service.listEvents(id);
  }

  @Post(':id/comments')
  @RequirePermissions('ncr.create')
  @ApiOperation({ summary: 'Append a comment to the NCR timeline' })
  comment(@Param('id') id: string, @Body() dto: NcrCommentDto) {
    return this.service.addComment(id, dto.note);
  }

  @Post(':id/evidence')
  @RequirePermissions('ncr.create')
  @ApiOperation({ summary: 'Attach a photo to the NCR (JPEG/PNG/WebP, ≤10 MB)' })
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
    fileFilter: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase();
      const ok = EVIDENCE_MIME_TYPES.includes((file.mimetype || '').toLowerCase()) && EVIDENCE_EXTENSIONS.includes(ext);
      cb(ok ? null : new BadRequestException('Evidence must be a JPEG, PNG or WebP image'), ok);
    },
    limits: { fileSize: EVIDENCE_MAX_BYTES },
  }))
  addEvidence(
    @Param('id') id: string,
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: EVIDENCE_MAX_BYTES })] }))
    file: Express.Multer.File,
  ) {
    return this.service.addEvidence(id, file);
  }

  @Get(':id/evidence/:index')
  @RequirePermissions('ncr.view')
  @ApiOperation({ summary: 'Stream a stored NCR photo by index' })
  async getEvidence(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Res() res: Response,
  ) {
    try {
      const { stream, key } = await this.service.getEvidenceStream(id, index);
      res.set({ 'Content-Type': evidenceContentType(key), 'Cache-Control': 'private, max-age=3600' });
      (stream as any).pipe(res);
    } catch {
      return res.status(404).json({ message: 'Evidence not found' });
    }
  }

  @Post()
  @RequirePermissions('ncr.create')
  @ApiOperation({ summary: 'Raise a non-conformance report (against a template)' })
  create(@Body() dto: CreateNcrDto) {
    return this.service.createNcr(dto);
  }

  @Patch(':id')
  @RequirePermissions('ncr.manage')
  @ApiOperation({ summary: 'Update / transition / disposition / close an NCR (workflow-validated)' })
  update(@Param('id') id: string, @Body() dto: UpdateNcrDto) {
    return this.service.updateNcr(id, dto);
  }
}
