import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as unzipper from 'unzipper';
import { ConversionJob } from './conversion-job.entity.js';
import { CreateConversionDto } from './dto/create-conversion.dto.js';
import { isSupportedInput, extOf } from './converters/converter.registry.js';
import { CONVERSION_QUEUE } from './queue/conversion-queue.interface.js';
import type { ConversionQueue } from './queue/conversion-queue.interface.js';
import type { StorageProvider } from '../storage/storage.interface.js';
import { STORAGE_PROVIDER } from '../storage/storage.interface.js';

const CAD_EXTS = ['step', 'stp', 'iges', 'igs', 'ifc'];

@Injectable()
export class ConversionService {
  constructor(
    @InjectRepository(ConversionJob) private readonly repo: Repository<ConversionJob>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(CONVERSION_QUEUE) private readonly queue: ConversionQueue,
  ) {}

  /**
   * Single-file upload: store the source, persist a job, enqueue, return.
   */
  async createJob(
    dto: CreateConversionDto,
    file: Express.Multer.File,
    userId?: string,
  ): Promise<ConversionJob> {
    const job = await this.enqueueOne(file.path, file.originalname, file.size, dto, userId, dto.name);
    this.cleanupStaging(file.path);
    if (!job) {
      throw new BadRequestException(`Unsupported file format: ${extOf(file.originalname) || '(none)'}`);
    }
    return job;
  }

  /**
   * Batch upload: accept multiple files and/or ZIP archives. ZIPs are expanded,
   * every supported 3D file inside is enqueued, and unsupported entries are
   * skipped. Each file runs through the same per-file pipeline.
   */
  async createBatch(
    files: Express.Multer.File[],
    dto: CreateConversionDto,
    userId?: string,
  ): Promise<ConversionJob[]> {
    const jobs: ConversionJob[] = [];
    const tempDirs: string[] = [];

    try {
      for (const file of files) {
        if (extOf(file.originalname) === '.zip') {
          const dir = path.join(os.tmpdir(), 'pcs-conversion-batch', crypto.randomUUID());
          fs.mkdirSync(dir, { recursive: true });
          tempDirs.push(dir);
          await this.extractZip(file.path, dir);
          this.cleanupStaging(file.path);

          for (const entry of this.walkFiles(dir)) {
            if (!isSupportedInput(entry)) continue;
            const job = await this.enqueueOne(entry, path.basename(entry), fs.statSync(entry).size, dto, userId);
            if (job) jobs.push(job);
          }
        } else {
          const job = await this.enqueueOne(file.path, file.originalname, file.size, dto, userId);
          this.cleanupStaging(file.path);
          if (job) jobs.push(job);
        }
      }
    } finally {
      for (const d of tempDirs) this.removeDir(d);
    }

    if (jobs.length === 0) {
      throw new BadRequestException('No supported 3D files found in the upload.');
    }
    return jobs;
  }

  /**
   * Store one source file and enqueue a job. Returns null if the format is not
   * supported (so batch can skip it). `nameOverride` sets the model name; when
   * omitted the file's base name is used (the batch case).
   */
  private async enqueueOne(
    srcPath: string,
    originalName: string,
    size: number,
    dto: CreateConversionDto,
    userId?: string,
    nameOverride?: string,
  ): Promise<ConversionJob | null> {
    if (!isSupportedInput(originalName)) return null;

    const fmt = extOf(originalName).replace('.', '');
    const isCad = CAD_EXTS.includes(fmt);
    const sourceUnit = dto.sourceUnit || (isCad ? 'mm' : 'm');
    const upAxis = dto.upAxis || (isCad ? 'Z' : 'Y');
    const envRatio = process.env.CONVERSION_SIMPLIFY_RATIO
      ? Number(process.env.CONVERSION_SIMPLIFY_RATIO)
      : undefined;
    const envMaxTexture = process.env.CONVERSION_MAX_TEXTURE
      ? Number(process.env.CONVERSION_MAX_TEXTURE)
      : undefined;
    const baseName = originalName.replace(/\.[^.]+$/, '');
    const options = {
      optimize: dto.optimize !== false,
      simplifyRatio: dto.simplifyRatio ?? envRatio,
      maxTexture: envMaxTexture,
      draco: !!dto.draco,
      quantize: !!dto.quantize,
      sourceUnit,
      upAxis,
    };

    // Dedupe: an identical file + identical options already converted -> reuse it
    // instead of re-running the (expensive) pipeline.
    const dedupeKey = await this.computeDedupeKey(srcPath, options);
    const prior = await this.repo.findOne({
      where: { sourceHash: dedupeKey, status: 'completed' },
      order: { createdAt: 'DESC' },
    });
    if (prior && prior.modelId) {
      const cloned = this.repo.create({
        originalName,
        sourceFormat: fmt,
        status: 'completed',
        progress: 100,
        sourceKey: prior.sourceKey,
        sourceSize: size,
        sourceHash: dedupeKey,
        outputKey: prior.outputKey,
        outputSize: prior.outputSize,
        dimensions: prior.dimensions,
        trianglesBefore: prior.trianglesBefore,
        trianglesAfter: prior.trianglesAfter,
        modelId: prior.modelId,
        name: nameOverride || baseName,
        description: dto.description || `Converted from ${originalName}`,
        modelType: dto.modelType || 'assembly',
        options,
        durationMs: 0,
        createdById: userId || null,
      });
      return this.repo.save(cloned);
    }

    const sourceKey = `conversion-sources/${crypto.randomUUID()}${extOf(originalName)}`;
    await this.storage.upload(srcPath, sourceKey, 'application/octet-stream');

    const job = this.repo.create({
      originalName,
      sourceFormat: fmt,
      status: 'pending',
      progress: 0,
      sourceKey,
      sourceSize: size,
      sourceHash: dedupeKey,
      name: nameOverride || baseName,
      description: dto.description || `Converted from ${originalName}`,
      modelType: dto.modelType || 'assembly',
      options,
      createdById: userId || null,
    });

    const saved = await this.repo.save(job);
    await this.queue.enqueue(saved.id);
    return saved;
  }

  async findOne(id: string): Promise<ConversionJob> {
    const job = await this.repo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Conversion job not found');
    return job;
  }

  async findAll(): Promise<ConversionJob[]> {
    return this.repo.find({ order: { createdAt: 'DESC' }, take: 100 });
  }

  /** Re-run a job (typically a failed one). The source is still in storage. */
  async retry(id: string): Promise<ConversionJob> {
    const job = await this.findOne(id);
    if (!job.sourceKey) {
      throw new BadRequestException('Cannot retry: the source file is no longer available.');
    }
    job.status = 'pending';
    job.progress = 0;
    job.error = null;
    job.durationMs = null;
    const saved = await this.repo.save(job);
    await this.queue.enqueue(saved.id);
    return saved;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** sha256 of the file content combined with the optimization options. */
  private computeDedupeKey(srcPath: string, options: Record<string, unknown>): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(srcPath);
      stream.on('data', (d) => hash.update(d));
      stream.on('error', reject);
      stream.on('end', () => {
        const fileHash = hash.digest('hex');
        const key = crypto.createHash('sha256').update(`${fileHash}:${JSON.stringify(options)}`).digest('hex');
        resolve(key);
      });
    });
  }

  private extractZip(zipPath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: destDir }))
        .on('close', () => resolve())
        .on('error', reject);
    });
  }

  private walkFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else out.push(p);
      }
    };
    walk(dir);
    return out;
  }

  private removeDir(dir: string): void {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  private cleanupStaging(filePath?: string): void {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }
}
