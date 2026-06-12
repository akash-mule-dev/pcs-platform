import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { Project } from './project.entity.js';
import { AssemblyNode, AssemblyNodeType } from './assembly-node.entity.js';
import { ImportFile, ImportFileStatus, IMPORT_STAGE_PROGRESS } from './import-file.entity.js';
import { ImportFileEvent } from './import-file-event.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { computeRevisionDiff, revisionSummaryMessage, RevisionDiff } from './revision-diff.js';
import { ConversionService } from '../conversion/conversion.service.js';
import { ConversionJob } from '../conversion/conversion-job.entity.js';
import { EventsGateway } from '../websocket/events.gateway.js';
import { STORAGE_PROVIDER } from '../storage/storage.interface.js';
import type { StorageProvider } from '../storage/storage.interface.js';

/** One node as emitted by extract-ifc-structure.mjs (the normalized intermediate). */
interface ExtractedNode {
  externalId: string;
  parentExternalId: string | null;
  type: 'group' | 'assembly' | 'subassembly' | 'part';
  ifcClass: string;
  name: string;
  mark: string | null;
  quantity: number;
  profile: string | null;
  materialGrade: string | null;
  lengthMm: number | null;
  weightKg: number | null;
  meshName: string | null;
  depth: number;
  sortIndex: number;
  properties: Record<string, unknown> | null;
}

interface ExtractResult {
  format: string;
  rootCount: number;
  nodeCount: number;
  counts: Record<string, number>;
  nodes: ExtractedNode[];
}

export interface ImportStarted {
  importFileId: string;
  originalName: string;
  status: ImportFileStatus;
  stage: string;
  progress: number;
}

/**
 * The import pipeline, redesigned around durability + observability:
 *
 *   1. `startImport` stores the source file FIRST (storage + import_files row),
 *      then returns immediately — the client only waits for the upload itself.
 *   2. The pipeline continues in the background:
 *        extracting (structure → JSON) → persisting (assembly_nodes upsert)
 *        → converting (GLB via the conversion queue) → completed.
 *   3. Every transition updates `import_files.stage/progress`, appends an
 *      `import_file_events` row (the history) and emits the room-scoped
 *      `import:progress` websocket event (the live monitoring feed).
 *   4. Because the source is stored durably, failed imports are retryable
 *      from exactly where they broke (full pipeline, or conversion only).
 *
 * Conversion progress (55→99%) is mirrored onto the import row by
 * ImportConversionLinkService inside the conversion processor, so it works in
 * both inline and BullMQ-worker modes and survives API restarts.
 */
@Injectable()
export class IfcImportService implements OnModuleInit {
  private readonly logger = new Logger(IfcImportService.name);
  // dist/projects -> dist/cad-conversion/scripts/extract-ifc-structure.mjs
  private readonly scriptPath = path.join(__dirname, '..', 'cad-conversion', 'scripts', 'extract-ifc-structure.mjs');
  private readonly tmpDir = path.join(os.tmpdir(), 'pcs-ifc-import');

  /**
   * FIFO pipeline queue with bounded concurrency: uploads beyond the limit
   * wait in the `queued` stage, which makes "N packages ahead of yours" a real
   * number on the monitor (and stops a burst of uploads from spawning an
   * unbounded number of extractor processes).
   */
  private readonly pipelineQueue: { importFileId: string; organizationId: string; projectName: string }[] = [];
  private runningPipelines = 0;
  private readonly pipelineConcurrency = Math.max(1, Number(process.env.IMPORT_PIPELINE_CONCURRENCY || 2));

  constructor(
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(ImportFile) private readonly importRepo: Repository<ImportFile>,
    @InjectRepository(ImportFileEvent) private readonly eventRepo: Repository<ImportFileEvent>,
    private readonly conversionService: ConversionService,
    private readonly ws: EventsGateway,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * Restart recovery: imports that were mid-pipeline when the process died are
   * re-queued from their durably stored source. Conversions already handed to
   * the conversion queue heal through the processor mirror / linkPendingModels.
   * (Single-API-instance assumption — same as the inline conversion driver.)
   */
  async onModuleInit(): Promise<void> {
    try {
      const stuck = await this.importRepo.find({
        where: [
          { status: In([ImportFileStatus.UPLOADED, ImportFileStatus.EXTRACTING]) },
          { status: ImportFileStatus.CONVERTING, conversionJobId: IsNull() },
        ],
      });
      const recoverable = stuck.filter((i) => !!i.storageKey && !!i.organizationId);
      if (!recoverable.length) return;
      const projects = await this.projectRepo.find({ where: { id: In(recoverable.map((i) => i.projectId)) } });
      const nameById = new Map(projects.map((p) => [p.id, p.name]));
      for (const imp of recoverable) {
        await this.record(imp, {
          stage: 'queued',
          status: ImportFileStatus.UPLOADED,
          progress: IMPORT_STAGE_PROGRESS.queued,
          message: 'Recovered after a service restart — re-queued from the stored source',
          detail: { recovered: true },
        });
        this.enqueuePipeline(imp.id, imp.organizationId as string, nameById.get(imp.projectId) ?? '');
      }
      this.logger.log(`Recovered ${recoverable.length} interrupted import(s) into the pipeline queue`);
    } catch (e) {
      this.logger.warn(`Import recovery sweep failed: ${this.errMsg(e)}`);
    }
  }

  // ── Pipeline scheduling (FIFO, bounded concurrency) ──────────────────

  /** Imports currently waiting or running ahead of a new arrival. */
  queueDepth(): number {
    return this.pipelineQueue.length + this.runningPipelines;
  }

  private enqueuePipeline(importFileId: string, organizationId: string, projectName: string): void {
    this.pipelineQueue.push({ importFileId, organizationId, projectName });
    this.pumpQueue();
  }

  private pumpQueue(): void {
    while (this.runningPipelines < this.pipelineConcurrency && this.pipelineQueue.length > 0) {
      const next = this.pipelineQueue.shift()!;
      this.runningPipelines++;
      void this.runPipeline(next.importFileId, next.organizationId, next.projectName)
        .catch((e) => this.logger.error(`Import pipeline ${next.importFileId} crashed: ${this.errMsg(e)}`))
        .finally(() => {
          this.runningPipelines--;
          this.pumpQueue();
        });
    }
  }

  // ───────────────────────────────────────────────────────────── start ──

  /**
   * Persist the upload durably (storage + DB row + first event), then kick the
   * pipeline in the background and return at once. The response carries the
   * importFileId the client uses to follow live progress (websocket/polling).
   */
  async startImport(
    projectId: string,
    originalName: string,
    data: Buffer,
    user?: { id?: string; email?: string; firstName?: string; lastName?: string },
  ): Promise<ImportStarted> {
    const organizationId = TenantContext.requireOrganizationId();
    const project = await this.projectRepo.findOne({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found');

    const format = path.extname(originalName).replace('.', '').toLowerCase() || 'ifc';
    const createdByName =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || null;

    const importFile = await this.importRepo.save(
      this.importRepo.create({
        projectId,
        organizationId,
        originalName,
        format,
        size: data.length,
        status: ImportFileStatus.UPLOADED,
        stage: 'uploaded',
        progress: 1,
        startedAt: new Date(),
        createdById: user?.id ?? null,
        createdByName,
      }),
    );

    // Store the source durably BEFORE any processing — this is what makes the
    // pipeline restartable/retryable and the history complete.
    fs.mkdirSync(this.tmpDir, { recursive: true });
    const stagePath = path.join(this.tmpDir, `${importFile.id}-upload${path.extname(originalName) || '.ifc'}`);
    try {
      fs.writeFileSync(stagePath, data);
      const storageKey = `import-sources/${importFile.id}${path.extname(originalName) || '.ifc'}`;
      await this.storage.upload(stagePath, storageKey, 'application/octet-stream');
      importFile.storageKey = storageKey;
      await this.record(importFile, {
        stage: 'uploaded',
        status: ImportFileStatus.UPLOADED,
        progress: IMPORT_STAGE_PROGRESS.uploaded,
        message: `File received (${this.fmtBytes(data.length)}) and stored`,
        detail: { size: data.length, format },
      });
    } catch (err) {
      await this.fail(importFile, 'uploaded', err);
      throw new BadRequestException(`Could not store the uploaded file: ${this.errMsg(err)}`);
    } finally {
      this.safeUnlink(stagePath);
    }

    // Hand off to the FIFO pipeline queue: the request returns now; the
    // monitor shows the live queue position and stage from here on.
    const ahead = this.queueDepth();
    await this.record(importFile, {
      stage: 'queued',
      status: ImportFileStatus.UPLOADED,
      progress: IMPORT_STAGE_PROGRESS.queued,
      message: ahead > 0 ? `Queued for processing — ${ahead} package(s) ahead` : 'Queued for processing',
      detail: { ahead },
    });
    this.enqueuePipeline(importFile.id, organizationId, project.name);

    return {
      importFileId: importFile.id,
      originalName,
      status: importFile.status,
      stage: importFile.stage,
      progress: importFile.progress,
    };
  }

  // ──────────────────────────────────────────────────────── pipeline ──

  /**
   * The background pipeline. Reads the source back from storage (so it also
   * serves retries and worker-mode), extracts + persists the structure, then
   * queues the GLB conversion. All state changes flow through `record`.
   */
  private async runPipeline(importFileId: string, organizationId: string, projectName: string): Promise<void> {
    const imp = await this.importRepo.findOne({ where: { id: importFileId, organizationId } });
    if (!imp || !imp.storageKey) return;

    fs.mkdirSync(this.tmpDir, { recursive: true });
    const inPath = path.join(this.tmpDir, `${imp.id}-src${path.extname(imp.originalName) || '.ifc'}`);
    const outPath = path.join(this.tmpDir, `${imp.id}-tree.json`);

    try {
      await this.downloadToFile(imp.storageKey, inPath);

      // 1. Extract structure
      await this.record(imp, {
        stage: 'extracting',
        status: ImportFileStatus.EXTRACTING,
        progress: IMPORT_STAGE_PROGRESS.extracting,
        message: 'Structure extraction started',
      });
      await this.runExtractor(inPath, outPath);
      const result = JSON.parse(fs.readFileSync(outPath, 'utf8')) as ExtractResult;

      // 2a. Revision diff: compare the incoming nodes against the tree AS IT
      // STANDS before this import mutates it (added/changed/missing pieces).
      let diff: RevisionDiff | null = null;
      try {
        const existing: any[] = await this.nodeRepo
          .createQueryBuilder('n')
          .select(['n.ifcGuid AS "ifcGuid"', 'n.nodeType AS "nodeType"', 'n.name AS name', 'n.mark AS mark',
            'n.quantity AS quantity', 'n.profile AS profile', 'n.materialGrade AS "materialGrade"',
            'n.lengthMm AS "lengthMm"', 'n.weightKg AS "weightKg"'])
          .where('n.organization_id = :org AND n.project_id = :pid', { org: organizationId, pid: imp.projectId })
          .getRawMany();
        diff = computeRevisionDiff(
          result.nodes.map((nd) => ({
            externalId: nd.externalId, type: nd.type, name: nd.name, mark: nd.mark,
            quantity: nd.quantity ?? 1, profile: nd.profile, materialGrade: nd.materialGrade,
            lengthMm: nd.lengthMm, weightKg: nd.weightKg,
          })),
          existing.map((e) => ({ ...e, quantity: Number(e.quantity ?? 1), lengthMm: e.lengthMm != null ? Number(e.lengthMm) : null, weightKg: e.weightKg != null ? Number(e.weightKg) : null })),
        );
        imp.revision = diff as unknown as Record<string, unknown>;
      } catch (e) {
        this.logger.warn(`Revision diff failed for ${imp.id} (import continues): ${this.errMsg(e)}`);
      }

      // 2b. Persist tree (progress 35 → 55, ticked per depth level)
      await this.record(imp, {
        stage: 'persisting',
        status: ImportFileStatus.EXTRACTING,
        progress: IMPORT_STAGE_PROGRESS.persisting,
        message: diff ? revisionSummaryMessage(diff) : `Structure extracted — persisting ${result.nodeCount} nodes`,
        detail: { counts: result.counts, rootCount: result.rootCount, revision: diff?.counts ?? null },
      });
      const nodeCount = await this.persistTree(
        organizationId, imp.projectId, imp.id, imp.format, result.nodes,
        async (done, total) => {
          const pct = IMPORT_STAGE_PROGRESS.persisting +
            Math.round((Math.min(done, total) / Math.max(total, 1)) * (IMPORT_STAGE_PROGRESS.converting - IMPORT_STAGE_PROGRESS.persisting));
          await this.tick(imp, pct);
        },
      );
      imp.nodeCount = nodeCount;
      await this.record(imp, {
        stage: 'persisting',
        status: ImportFileStatus.EXTRACTING,
        progress: IMPORT_STAGE_PROGRESS.converting,
        message: `Assembly tree ready: ${nodeCount} nodes (${result.counts['part'] ?? 0} parts)`,
        detail: { nodeCount, counts: result.counts },
      });

      // 3. Queue GLB conversion. Its progress (55→99) + completion/failure are
      // mirrored onto this row by the conversion processor; a dedupe hit
      // returns an already-completed job, which we link right here.
      const job = await this.queueConversion(imp, inPath, projectName);
      if (job) {
        imp.conversionJobId = job.id;
        if (job.status === 'completed' && job.modelId) {
          await this.linkModel(imp, job.modelId, 'reused an identical prior conversion');
        } else if (job.status === 'failed') {
          await this.fail(imp, 'converting', job.error || '3D conversion failed');
        } else {
          await this.record(imp, {
            stage: 'converting',
            status: ImportFileStatus.CONVERTING,
            progress: IMPORT_STAGE_PROGRESS.converting,
            message: '3D model (GLB) conversion queued',
            detail: { conversionJobId: job.id },
          });
        }
      } else {
        // Geometry pipeline unavailable for this format — structure still usable.
        await this.complete(imp, 'Import complete (no 3D conversion for this format)');
      }
    } catch (err) {
      const imp2 = await this.importRepo.findOne({ where: { id: importFileId } });
      if (imp2) await this.fail(imp2, imp2.stage || 'extracting', err);
    } finally {
      this.safeUnlink(inPath);
      this.safeUnlink(outPath);
    }
  }

  /** Hand the source to the conversion queue (its own staging copy). */
  private async queueConversion(imp: ImportFile, srcPath: string, projectName: string): Promise<ConversionJob | null> {
    const bgPath = path.join(this.tmpDir, `${imp.id}-conv${path.extname(imp.originalName) || '.ifc'}`);
    fs.copyFileSync(srcPath, bgPath);
    try {
      const base = path.basename(imp.originalName, path.extname(imp.originalName));
      const stats = fs.statSync(bgPath);
      const file = this.asMulterFile(bgPath, imp.originalName, stats.size, 'application/octet-stream');
      const job = await this.conversionService.createJob(
        { name: projectName || base, description: `Imported from ${imp.originalName}`, modelType: 'assembly' },
        file,
      );
      return job;
    } finally {
      this.safeUnlink(bgPath);
    }
  }

  // ─────────────────────────────────────────────────────────── retry ──

  /**
   * Re-run a failed import. If the structure already extracted and only the
   * GLB conversion failed, just the conversion is re-queued; otherwise the
   * whole pipeline restarts from the stored source file.
   */
  async retryImport(projectId: string, importFileId: string): Promise<ImportStarted> {
    const organizationId = TenantContext.requireOrganizationId();
    const imp = await this.importRepo.findOne({ where: { id: importFileId, projectId, organizationId } });
    if (!imp) throw new NotFoundException('Import not found');
    if (imp.status !== ImportFileStatus.FAILED) {
      throw new BadRequestException('Only failed imports can be retried');
    }
    if (!imp.storageKey) {
      throw new BadRequestException('The source file of this import is no longer available');
    }
    const project = await this.projectRepo.findOne({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found');

    imp.error = null;
    imp.finishedAt = null;
    imp.durationMs = null;
    imp.startedAt = new Date();

    // Conversion-only retry: structure is in, the job exists and can be re-run.
    let conversionOnly = false;
    let job: ConversionJob | null = null;
    if (imp.nodeCount > 0 && imp.conversionJobId) {
      try {
        job = await this.conversionService.retry(imp.conversionJobId);
        conversionOnly = true;
      } catch {
        conversionOnly = false; // source gone from the conversion side → full re-run
      }
    }

    if (conversionOnly && job) {
      await this.record(imp, {
        stage: 'converting',
        status: ImportFileStatus.CONVERTING,
        progress: IMPORT_STAGE_PROGRESS.converting,
        message: 'Retry: 3D conversion re-queued',
        detail: { conversionJobId: job.id, retry: true },
      });
    } else {
      const ahead = this.queueDepth();
      await this.record(imp, {
        stage: 'queued',
        status: ImportFileStatus.UPLOADED,
        progress: IMPORT_STAGE_PROGRESS.queued,
        message: ahead > 0
          ? `Retry: re-queued from the stored source — ${ahead} package(s) ahead`
          : 'Retry: re-queued from the stored source',
        detail: { retry: true, ahead },
      });
      this.enqueuePipeline(imp.id, organizationId, project.name);
    }

    return {
      importFileId: imp.id,
      originalName: imp.originalName,
      status: imp.status,
      stage: imp.stage,
      progress: imp.progress,
    };
  }

  // ─────────────────────────────────────────────────────── monitoring ──

  /** All imports of a project, newest first — the monitoring history. */
  async listImports(projectId: string): Promise<ImportFile[]> {
    const organizationId = TenantContext.requireOrganizationId();
    return this.importRepo.find({
      where: { organizationId, projectId },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  /** One import + its full event timeline + a conversion-job snapshot. */
  async getImportDetail(projectId: string, importFileId: string) {
    const organizationId = TenantContext.requireOrganizationId();
    const file = await this.importRepo.findOne({ where: { id: importFileId, projectId, organizationId } });
    if (!file) throw new NotFoundException('Import not found');
    const events = await this.eventRepo.find({
      where: { importFileId: file.id, organizationId },
      order: { createdAt: 'ASC' },
    });
    let conversion: Pick<ConversionJob, 'id' | 'status' | 'progress' | 'error' | 'durationMs' | 'trianglesAfter' | 'outputSize'> | null = null;
    if (file.conversionJobId) {
      try {
        const j = await this.conversionService.findOne(file.conversionJobId);
        conversion = {
          id: j.id, status: j.status, progress: j.progress, error: j.error,
          durationMs: j.durationMs, trianglesAfter: j.trianglesAfter, outputSize: j.outputSize,
        };
      } catch { /* job purged — row data stands on its own */ }
    }
    return { file, events, conversion };
  }

  /**
   * Revision impact: for the pieces this import CHANGED or no longer contains,
   * what production has already happened? Work recorded on a changed piece is
   * money at risk — this is the change-order report. WOs attach at assembly
   * level while changes often hit parts, so impact rolls up through ancestors.
   */
  async getImportRevision(projectId: string, importFileId: string) {
    const organizationId = TenantContext.requireOrganizationId();
    const imp = await this.importRepo.findOne({ where: { id: importFileId, projectId, organizationId } });
    if (!imp) throw new NotFoundException('Import not found');
    const diff = (imp.revision ?? null) as unknown as RevisionDiff | null;
    if (!diff) return { diff: null, impact: null };

    const affected = [
      ...(diff.changed ?? []).map((e) => ({ ...e, kind: 'changed' as const })),
      ...(diff.missing ?? []).map((e) => ({ ...e, kind: 'missing' as const })),
    ];
    const empty = { summary: { pieces: 0, critical: 0, high: 0, medium: 0, none: 0 }, rows: [] as any[] };
    if (!affected.length) return { diff, impact: empty };

    // Minimal whole-tree map for ancestor rollup (id, parent, guid).
    const tree: { id: string; parent_id: string | null; ifc_guid: string | null }[] = await this.nodeRepo.query(
      `SELECT id, parent_id, ifc_guid FROM assembly_nodes WHERE organization_id = $1 AND project_id = $2`,
      [organizationId, projectId],
    );
    const parentOf = new Map(tree.map((t) => [t.id, t.parent_id]));
    const idByGuid = new Map(tree.filter((t) => t.ifc_guid).map((t) => [t.ifc_guid as string, t.id]));

    // Work + shipping state per assembly node (one query each).
    const woRows: any[] = await this.nodeRepo.query(
      `SELECT w.assembly_node_id AS node_id, w.id, w.order_number, w.status, o.number AS po_number,
              COALESCE(SUM(s.qty_total) FILTER (WHERE s.status <> 'skipped'), 0)::int AS units_total,
              COALESCE(SUM(LEAST(s.qty_done, s.qty_total)) FILTER (WHERE s.status <> 'skipped'), 0)::int AS units_done
         FROM work_orders w
         LEFT JOIN production_orders o ON o.id = w.production_order_id
         LEFT JOIN work_order_stages s ON s.work_order_id = w.id
        WHERE w.organization_id = $1 AND w.assembly_node_id IS NOT NULL AND w.status <> 'cancelled'
          AND w.assembly_node_id IN (SELECT id FROM assembly_nodes WHERE project_id = $2)
        GROUP BY w.assembly_node_id, w.id, w.order_number, w.status, o.number`,
      [organizationId, projectId],
    );
    const wosByNode = new Map<string, any[]>();
    for (const r of woRows) {
      const arr = wosByNode.get(r.node_id) ?? [];
      arr.push(r);
      wosByNode.set(r.node_id, arr);
    }
    const shipRows: any[] = await this.nodeRepo.query(
      `SELECT si.assembly_node_id AS node_id, SUM(si.quantity)::int AS shipped
         FROM shipment_items si JOIN shipments sh ON sh.id = si.shipment_id
        WHERE si.organization_id = $1 AND sh.project_id = $2 AND sh.status IN ('shipped','delivered')
        GROUP BY si.assembly_node_id`,
      [organizationId, projectId],
    );
    const shippedByNode = new Map<string, number>(shipRows.map((r) => [r.node_id, Number(r.shipped)]));

    const rows = affected.map((e) => {
      // Walk self → ancestors, collecting any production touching this piece.
      const wos: any[] = [];
      let shippedQty = 0;
      let nodeId = idByGuid.get(e.guid) ?? null;
      const hops = new Set<string>();
      while (nodeId && !hops.has(nodeId)) {
        hops.add(nodeId);
        for (const w of wosByNode.get(nodeId) ?? []) wos.push(w);
        shippedQty += shippedByNode.get(nodeId) ?? 0;
        nodeId = parentOf.get(nodeId) ?? null;
      }
      const unitsDone = wos.reduce((a, w) => a + Number(w.units_done), 0);
      const severity = shippedQty > 0 ? 'critical' : unitsDone > 0 ? 'high' : wos.length > 0 ? 'medium' : 'none';
      return {
        kind: e.kind,
        guid: e.guid,
        mark: e.mark,
        name: e.name,
        deltas: (e as any).deltas ?? null,
        severity,
        shippedQty,
        workOrders: wos.map((w) => ({
          orderNumber: w.order_number,
          productionOrder: w.po_number,
          status: w.status,
          unitsDone: Number(w.units_done),
          unitsTotal: Number(w.units_total),
        })),
      };
    });
    rows.sort((a, b) => ['critical', 'high', 'medium', 'none'].indexOf(a.severity) - ['critical', 'high', 'medium', 'none'].indexOf(b.severity));

    const summary = {
      pieces: rows.length,
      critical: rows.filter((r) => r.severity === 'critical').length,
      high: rows.filter((r) => r.severity === 'high').length,
      medium: rows.filter((r) => r.severity === 'medium').length,
      none: rows.filter((r) => r.severity === 'none').length,
    };
    return { diff, impact: { summary, rows } };
  }

  /**
   * Healing path (kept from the original design): link models produced by
   * queued conversions back to their import's nodes. Covers events missed
   * while no API was running. Called when a project is opened.
   */
  async linkPendingModels(projectId: string): Promise<{ linked: number; pending: number; failed: number }> {
    const organizationId = TenantContext.requireOrganizationId();
    const imports = await this.importRepo.find({ where: { organizationId, projectId } });
    let linked = 0;
    let pending = 0;
    let failed = 0;
    for (const imp of imports) {
      if (imp.modelId) continue;
      if (imp.status === ImportFileStatus.FAILED) { failed++; continue; }
      if (!imp.conversionJobId) {
        // Pipeline hasn't reached conversion yet (or died before queueing it).
        if (imp.status !== ImportFileStatus.COMPLETED) pending++;
        continue;
      }
      let job;
      try { job = await this.conversionService.findOne(imp.conversionJobId); } catch { continue; }
      if (job.status === 'completed' && job.modelId) {
        await this.linkModel(imp, job.modelId, 'linked by background check');
        linked++;
      } else if (job.status === 'failed') {
        if (imp.status !== (ImportFileStatus.FAILED as ImportFileStatus)) {
          await this.fail(imp, 'converting', job.error || '3D conversion failed');
        }
        failed++;
      } else {
        pending++;
      }
    }
    return { linked, pending, failed };
  }

  // ──────────────────────────────────────────────── state transitions ──

  /** Mark the model linked and the import complete (+ stamp the tree). */
  private async linkModel(imp: ImportFile, modelId: string, how: string): Promise<void> {
    imp.modelId = modelId;
    await this.nodeRepo.update(
      { organizationId: imp.organizationId as string, projectId: imp.projectId, importFileId: imp.id },
      { modelId },
    );
    await this.complete(imp, `3D model linked (${how})`, { modelId });
  }

  private async complete(imp: ImportFile, message: string, detail?: Record<string, unknown>): Promise<void> {
    imp.finishedAt = new Date();
    imp.durationMs = imp.startedAt ? imp.finishedAt.getTime() - new Date(imp.startedAt).getTime() : null;
    await this.record(imp, {
      stage: 'completed',
      status: ImportFileStatus.COMPLETED,
      progress: 100,
      message,
      detail: { ...detail, durationMs: imp.durationMs },
    });
  }

  private async fail(imp: ImportFile, atStage: string, err: unknown): Promise<void> {
    const msg = this.errMsg(err);
    imp.error = msg;
    imp.finishedAt = new Date();
    imp.durationMs = imp.startedAt ? imp.finishedAt.getTime() - new Date(imp.startedAt).getTime() : null;
    await this.record(imp, {
      stage: 'failed',
      status: ImportFileStatus.FAILED,
      progress: imp.progress,
      message: `${this.stageLabel(atStage)} failed: ${msg}`,
      detail: { failedStage: atStage, durationMs: imp.durationMs },
    });
  }

  /**
   * Single write path for every transition: persists the row, appends the
   * history event and pushes the live websocket update.
   */
  private async record(
    imp: ImportFile,
    t: { stage: string; status: ImportFileStatus; progress: number; message: string; detail?: Record<string, unknown> },
  ): Promise<void> {
    imp.stage = t.stage;
    imp.status = t.status;
    imp.progress = t.progress;
    await this.importRepo.save(imp);
    try {
      await this.eventRepo.save(
        this.eventRepo.create({
          organizationId: imp.organizationId,
          importFileId: imp.id,
          projectId: imp.projectId,
          stage: t.stage,
          status: t.status,
          progress: t.progress,
          message: t.message,
          detail: t.detail ?? null,
        }),
      );
    } catch (e) {
      this.logger.warn(`Could not append import event for ${imp.id}: ${this.errMsg(e)}`);
    }
    this.emit(imp, t.message);
  }

  /** Progress-only update (no history row) — keeps the live bar moving. */
  private async tick(imp: ImportFile, progress: number): Promise<void> {
    if (progress <= imp.progress) return;
    imp.progress = progress;
    await this.importRepo.update({ id: imp.id }, { progress });
    this.emit(imp);
  }

  private emit(imp: ImportFile, message?: string): void {
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
        message: message ?? null,
        at: new Date().toISOString(),
      });
    } catch { /* live feed is best-effort */ }
  }

  // ───────────────────────────────────────────────────────── internals ──

  private asMulterFile(filePath: string, originalname: string, size: number, mimetype: string): Express.Multer.File {
    return {
      fieldname: 'file',
      originalname,
      encoding: '7bit',
      mimetype,
      size,
      destination: path.dirname(filePath),
      filename: `${crypto.randomUUID()}${path.extname(filePath)}`,
      path: filePath,
      buffer: Buffer.alloc(0),
      stream: fs.createReadStream(filePath),
    } as Express.Multer.File;
  }

  /**
   * Upsert the extracted nodes (DFS pre-order so a parent persists before its
   * children). Idempotent by ifc_guid so re-importing a revised IFC updates
   * rather than duplicates. Reports persistence progress per depth level.
   */
  private async persistTree(
    organizationId: string,
    projectId: string,
    importFileId: string,
    format: string,
    nodes: ExtractedNode[],
    onProgress?: (done: number, total: number) => Promise<void>,
  ): Promise<number> {
    // BATCHED: per-node findOne+save was 2 round trips x N nodes against a
    // remote DB (minutes for a real model). Load all existing nodes in chunks,
    // then save level-by-level (parents before children) in chunked batches.
    const existingByGuid = new Map<string, AssemblyNode>();
    const guids = nodes.map((n) => n.externalId);
    for (let i = 0; i < guids.length; i += 500) {
      const batch = await this.nodeRepo.find({ where: { organizationId, projectId, ifcGuid: In(guids.slice(i, i + 500)) } });
      for (const e of batch) if (e.ifcGuid) existingByGuid.set(e.ifcGuid, e);
    }

    const byDepth = new Map<number, ExtractedNode[]>();
    for (const n of nodes) {
      const arr = byDepth.get(n.depth) ?? [];
      arr.push(n);
      byDepth.set(n.depth, arr);
    }

    const idByExternal = new Map<string, string>();
    let count = 0;
    for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
      const level = byDepth.get(depth)!;
      const entities = level.map((n) => {
        const entity = existingByGuid.get(n.externalId) ?? this.nodeRepo.create();
        Object.assign(entity, {
          organizationId,
          projectId,
          parentId: n.parentExternalId ? idByExternal.get(n.parentExternalId) ?? null : null,
          nodeType: n.type as AssemblyNodeType,
          name: n.name,
          mark: n.mark,
          quantity: n.quantity ?? 1,
          ifcGuid: n.externalId,
          ifcClass: n.ifcClass,
          sourceFormat: format,
          importFileId,
          profile: n.profile,
          materialGrade: n.materialGrade,
          lengthMm: n.lengthMm,
          weightKg: n.weightKg,
          meshName: n.meshName,
          properties: n.properties as Record<string, any> | null,
          depth: n.depth,
          sortIndex: n.sortIndex,
        });
        return entity;
      });
      const saved = await this.nodeRepo.save(entities, { chunk: 200 });
      saved.forEach((s, i) => idByExternal.set(level[i].externalId, s.id));
      count += saved.length;
      if (onProgress) {
        try { await onProgress(count, nodes.length); } catch { /* progress is best-effort */ }
      }
    }
    return count;
  }

  private runExtractor(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['--max-old-space-size=4096', this.scriptPath, inputPath, outputPath], {
        timeout: 300_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('close', (code) => {
        if (stdout) this.logger.log(`IFC extractor: ${stdout.trim()}`);
        code === 0 ? resolve() : reject(new Error(`IFC extractor exited with code ${code}: ${stderr}`));
      });
      child.on('error', (err) => reject(new Error(`Failed to spawn IFC extractor: ${err.message}`)));
    });
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

  private stageLabel(stage: string): string {
    return {
      uploaded: 'Upload',
      extracting: 'Structure extraction',
      persisting: 'Tree persistence',
      converting: '3D conversion',
      completed: 'Completion',
      failed: 'Pipeline',
    }[stage] ?? 'Pipeline';
  }

  private fmtBytes(n: number): string {
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  }

  private errMsg(err: unknown): string {
    return String(err instanceof Error ? err.message : err);
  }

  private safeUnlink(p: string): void {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
  }
}
