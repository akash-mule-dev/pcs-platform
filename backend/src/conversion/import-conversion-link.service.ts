import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversionJob } from './conversion-job.entity.js';
import { ImportFile, ImportFileStatus } from '../projects/import-file.entity.js';
import { ImportFileEvent } from '../projects/import-file-event.entity.js';
import { AssemblyNode } from '../projects/assembly-node.entity.js';
import { EventsGateway } from '../websocket/events.gateway.js';

/**
 * Mirrors conversion-job progress onto the project-import pipeline.
 *
 * A project import (`import_files`) queues a GLB conversion and records the
 * job id. This service — invoked by ConversionProcessor on every job status
 * change — projects that job's progress into the import row (55→99%), appends
 * history events for stage transitions, links the produced model to the
 * assembly tree on success, and emits the room-scoped `import:progress`
 * websocket event. Because it runs inside the processor it behaves identically
 * on the inline driver and on a BullMQ worker, and keeps working across API
 * restarts (entity-only dependency on the projects module — no module cycle).
 */
@Injectable()
export class ImportConversionLinkService {
  private readonly logger = new Logger(ImportConversionLinkService.name);

  constructor(
    @InjectRepository(ImportFile) private readonly importRepo: Repository<ImportFile>,
    @InjectRepository(ImportFileEvent) private readonly eventRepo: Repository<ImportFileEvent>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    private readonly ws: EventsGateway,
  ) {}

  /** Map a conversion job's 0–100 progress into the import pipeline's 55–99 band. */
  static overallProgress(jobProgress: number): number {
    const p = Math.max(0, Math.min(100, jobProgress || 0));
    return Math.min(99, 55 + Math.round(p * 0.44));
  }

  /** Best-effort: must never fail the conversion itself. */
  async mirror(job: ConversionJob): Promise<void> {
    try {
      const imports = await this.importRepo.find({ where: { conversionJobId: job.id } });
      for (const imp of imports) {
        if (imp.status === ImportFileStatus.COMPLETED) continue; // already linked
        if (job.status === 'completed' && job.modelId) {
          await this.completeImport(imp, job);
        } else if (job.status === 'failed') {
          await this.failImport(imp, job);
        } else {
          await this.progressImport(imp, job);
        }
      }
    } catch (e) {
      this.logger.warn(`Import mirror for job ${job.id} failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async progressImport(imp: ImportFile, job: ConversionJob): Promise<void> {
    const progress = ImportConversionLinkService.overallProgress(job.progress);
    const enteredConverting = imp.stage !== 'converting';
    imp.stage = 'converting';
    imp.status = ImportFileStatus.CONVERTING;
    imp.progress = Math.max(imp.progress, progress);
    await this.importRepo.save(imp);
    const message = this.statusMessage(job.status);
    if (enteredConverting || job.status === 'optimizing' || job.status === 'uploading') {
      await this.appendEvent(imp, message, { conversionJobId: job.id, jobStatus: job.status, jobProgress: job.progress });
    }
    this.emit(imp, message);
  }

  private async completeImport(imp: ImportFile, job: ConversionJob): Promise<void> {
    imp.modelId = job.modelId;
    imp.stage = 'completed';
    imp.status = ImportFileStatus.COMPLETED;
    imp.progress = 100;
    imp.error = null;
    imp.finishedAt = new Date();
    imp.durationMs = imp.startedAt ? imp.finishedAt.getTime() - new Date(imp.startedAt).getTime() : null;
    await this.importRepo.save(imp);
    // Stamp the GLB onto the tree so the 3D viewer lights up without a reload-poll.
    await this.nodeRepo.update(
      { organizationId: imp.organizationId as string, projectId: imp.projectId, importFileId: imp.id },
      { modelId: job.modelId! },
    );
    await this.appendEvent(imp, '3D model linked — import complete', {
      conversionJobId: job.id,
      modelId: job.modelId,
      outputSize: job.outputSize,
      trianglesAfter: job.trianglesAfter,
      durationMs: imp.durationMs,
    });
    this.emit(imp, '3D model linked — import complete');
    // Tenant-wide signal so any client with this project's model cached (even one
    // not currently viewing it) evicts the stale copy and re-downloads on next open.
    try {
      this.ws.emitProjectModelUpdated({
        projectId: imp.projectId,
        modelId: job.modelId ?? null,
        importId: imp.id,
        organizationId: (imp.organizationId as string | null) ?? null,
      });
    } catch { /* best-effort */ }
  }

  private async failImport(imp: ImportFile, job: ConversionJob): Promise<void> {
    imp.stage = 'failed';
    imp.status = ImportFileStatus.FAILED;
    imp.error = job.error || '3D conversion failed';
    imp.finishedAt = new Date();
    imp.durationMs = imp.startedAt ? imp.finishedAt.getTime() - new Date(imp.startedAt).getTime() : null;
    await this.importRepo.save(imp);
    await this.appendEvent(imp, `3D conversion failed: ${imp.error}`, {
      conversionJobId: job.id,
      failedStage: 'converting',
    });
    this.emit(imp, `3D conversion failed: ${imp.error}`);
  }

  private async appendEvent(imp: ImportFile, message: string, detail: Record<string, unknown>): Promise<void> {
    try {
      await this.eventRepo.save(
        this.eventRepo.create({
          organizationId: imp.organizationId,
          importFileId: imp.id,
          projectId: imp.projectId,
          stage: imp.stage,
          status: imp.status,
          progress: imp.progress,
          message,
          detail,
        }),
      );
    } catch (e) {
      this.logger.warn(`Could not append import event for ${imp.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  private emit(imp: ImportFile, message: string): void {
    try {
      this.ws.emitImportProgress({
        importFileId: imp.id,
        projectId: imp.projectId,
        status: imp.status,
        stage: imp.stage,
        progress: imp.progress,
        originalName: imp.originalName,
        nodeCount: imp.nodeCount,
        modelId: imp.modelId,
        conversionJobId: imp.conversionJobId,
        error: imp.error,
        message,
        at: new Date().toISOString(),
      });
    } catch { /* live feed is best-effort */ }
  }

  private statusMessage(status: string): string {
    return {
      pending: '3D conversion queued',
      converting: 'Converting geometry to GLB',
      optimizing: 'Optimizing 3D model for web & AR',
      uploading: 'Storing the 3D model',
    }[status] ?? `3D conversion: ${status}`;
  }
}
