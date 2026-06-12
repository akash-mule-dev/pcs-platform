import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConversionJob, ConversionStatus } from './conversion-job.entity.js';
import { converterFor } from './converters/converter.registry.js';
import { MeshConverter } from './converters/mesh-converter.js';
import { GlbOptimizer } from './optimize/glb-optimizer.js';
import { CadConversionService } from '../cad-conversion/cad-conversion.service.js';
import { ModelsService } from '../models/models.service.js';
import type { StorageProvider } from '../storage/storage.interface.js';
import { STORAGE_PROVIDER } from '../storage/storage.interface.js';
import { EventsGateway } from '../websocket/events.gateway.js';
import { ImportConversionLinkService } from './import-conversion-link.service.js';

/**
 * The staged conversion pipeline. Invoked identically by the inline driver and
 * the BullMQ worker, so behavior never diverges between dev and prod.
 */
@Injectable()
export class ConversionProcessor {
  private readonly logger = new Logger(ConversionProcessor.name);
  private readonly tempDir = path.join(os.tmpdir(), 'pcs-conversion');

  constructor(
    @InjectRepository(ConversionJob) private readonly repo: Repository<ConversionJob>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly cadService: CadConversionService,
    private readonly meshConverter: MeshConverter,
    private readonly optimizer: GlbOptimizer,
    private readonly modelsService: ModelsService,
    private readonly ws: EventsGateway,
    private readonly importLink: ImportConversionLinkService,
  ) {
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
  }

  async process(jobId: string): Promise<void> {
    const job = await this.repo.findOne({ where: { id: jobId } });
    if (!job) {
      this.logger.warn(`Conversion job ${jobId} not found`);
      return;
    }

    const started = Date.now();
    const temps: string[] = [];

    try {
      // 1. Fetch the source from storage (works across processes/hosts).
      await this.setStatus(job, 'converting', 10);
      if (!job.sourceKey) throw new Error('Job has no source file');
      const srcPath = path.join(this.tempDir, `${job.id}-src${path.extname(job.originalName)}`);
      await this.downloadToFile(job.sourceKey, srcPath);
      temps.push(srcPath);

      // 2. Convert to an intermediate GLB based on input type.
      const kind = converterFor(job.originalName);
      let glbPath = path.join(this.tempDir, `${job.id}-converted.glb`);

      if (kind === 'cad') {
        const r = await this.cadService.convert(srcPath, job.originalName);
        if (!r.success) throw new Error(r.error || 'CAD conversion failed');
        glbPath = r.outputPath; // CAD service writes to its own temp dir
      } else if (kind === 'mesh') {
        const r = await this.meshConverter.convert(srcPath, glbPath);
        if (!r.success) throw new Error(r.error || 'Mesh conversion failed');
      } else {
        // passthrough: already GLB
        fs.copyFileSync(srcPath, glbPath);
      }
      temps.push(glbPath);

      // 3. Optimize for AR/web/app (unless disabled).
      let finalGlb = glbPath;
      const opts = job.options || {};
      if (opts.optimize !== false) {
        await this.setStatus(job, 'optimizing', 55);
        const optPath = path.join(this.tempDir, `${job.id}-optimized.glb`);
        const res = await this.optimizer.optimize(glbPath, optPath, {
          simplifyRatio: opts.simplifyRatio,
          maxTexture: opts.maxTexture,
          draco: opts.draco,
          quantize: opts.quantize,
          sourceUnit: opts.sourceUnit,
          upAxis: opts.upAxis as 'Y' | 'Z' | undefined,
        });
        if (res.success) {
          finalGlb = res.outputPath;
          temps.push(optPath);
          job.trianglesBefore = res.trianglesBefore ?? null;
          job.trianglesAfter = res.trianglesAfter ?? null;
          job.dimensions = res.dimensions ?? null;
        } else {
          this.logger.warn(`Optimization failed for ${job.id}, using unoptimized GLB: ${res.error}`);
        }
      }

      // 4 + 5. Persist as a Model3D (ModelsService uploads the GLB to storage).
      await this.setStatus(job, 'uploading', 85);
      const model = await this.createModel(job, finalGlb);
      job.modelId = model.id;
      job.outputKey = model.fileName;
      job.outputSize = model.fileSize;

      job.durationMs = Date.now() - started;
      await this.setStatus(job, 'completed', 100);
      this.logger.log(`Conversion ${job.id} completed -> model ${model.id}`);
    } catch (err: any) {
      job.error = String(err?.message || err);
      job.durationMs = Date.now() - started;
      await this.setStatus(job, 'failed', job.progress);
      this.logger.error(`Conversion ${job.id} failed: ${job.error}`);
      throw err; // let BullMQ see the failure (retry/backoff)
    } finally {
      for (const f of temps) this.safeUnlink(f);
    }
  }

  private async createModel(job: ConversionJob, glbPath: string) {
    const stats = fs.statSync(glbPath);
    const baseName = path.basename(job.originalName, path.extname(job.originalName));
    const file: Express.Multer.File = {
      fieldname: 'file',
      originalname: `${baseName}.glb`,
      encoding: '7bit',
      mimetype: 'model/gltf-binary',
      size: stats.size,
      destination: path.dirname(glbPath),
      filename: `${crypto.randomUUID()}.glb`,
      path: glbPath,
      buffer: Buffer.alloc(0),
      stream: fs.createReadStream(glbPath),
    };
    return this.modelsService.create(
      {
        name: job.name || job.originalName,
        description: job.description || `Converted from ${job.originalName}`,
        modelType: (job.modelType as 'assembly' | 'quality') || 'assembly',
      },
      file,
    );
  }

  private async downloadToFile(key: string, destPath: string): Promise<void> {
    const src = await this.storage.download(key);
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(destPath);
      src.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => resolve());
      src.pipe(out);
    });
  }

  private async setStatus(job: ConversionJob, status: ConversionStatus, progress: number): Promise<void> {
    job.status = status;
    job.progress = progress;
    await this.repo.save(job);
    this.ws.emitConversionProgress({
      jobId: job.id,
      status,
      progress,
      originalName: job.originalName,
      sourceFormat: job.sourceFormat,
      modelId: job.modelId,
      trianglesBefore: job.trianglesBefore,
      trianglesAfter: job.trianglesAfter,
      dimensions: job.dimensions,
      error: job.error,
    });
    // Project the job's progress onto any project import that queued it
    // (live monitoring + history). Best-effort, never fails the conversion.
    await this.importLink.mirror(job);
  }

  private safeUnlink(filePath: string): void {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* ignore cleanup errors */
    }
  }
}
