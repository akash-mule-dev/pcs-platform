import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { Project } from './project.entity.js';
import { AssemblyNode, AssemblyNodeType } from './assembly-node.entity.js';
import { ImportFile, ImportFileStatus } from './import-file.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { ConversionService } from '../conversion/conversion.service.js';

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

@Injectable()
export class IfcImportService {
  private readonly logger = new Logger(IfcImportService.name);
  // dist/projects -> dist/cad-conversion/scripts/extract-ifc-structure.mjs
  private readonly scriptPath = path.join(__dirname, '..', 'cad-conversion', 'scripts', 'extract-ifc-structure.mjs');

  constructor(
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(ImportFile) private readonly importRepo: Repository<ImportFile>,
    private readonly conversionService: ConversionService,
  ) {}

  /**
   * Import an IFC into a project: extract its structure into `assembly_nodes`
   * (idempotent by ifc_guid) and ALWAYS queue the IFC->GLB conversion on the
   * async pipeline. The model is linked back to the tree by linkPendingModels()
   * once the conversion completes (a dedupe hit links immediately).
   */
  async importIfc(
    projectId: string,
    originalName: string,
    data: Buffer,
  ): Promise<{ importFileId: string; nodeCount: number; counts: Record<string, number>; modelId: string | null; glbQueued: boolean }> {
    const organizationId = TenantContext.requireOrganizationId();
    const project = await this.projectRepo.findOne({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found');

    const format = path.extname(originalName).replace('.', '').toLowerCase() || 'ifc';
    const importFile = await this.importRepo.save(
      this.importRepo.create({
        projectId,
        organizationId,
        originalName,
        format,
        size: data.length,
        status: ImportFileStatus.EXTRACTING,
      }),
    );

    const tmpDir = path.join(os.tmpdir(), 'pcs-ifc-import');
    fs.mkdirSync(tmpDir, { recursive: true });
    const inPath = path.join(tmpDir, `${crypto.randomUUID()}.ifc`);
    const outPath = path.join(tmpDir, `${crypto.randomUUID()}.json`);
    fs.writeFileSync(inPath, data);

    let modelId: string | null = null;
    let glbQueued = false;
    try {
      await this.runExtractor(inPath, outPath);
      const result = JSON.parse(fs.readFileSync(outPath, 'utf8')) as ExtractResult;
      const nodeCount = await this.persistTree(organizationId, projectId, importFile.id, format, result.nodes);

      // Kick the GLB conversion WITHOUT blocking the response — on the inline
      // (no-Redis) queue it converts synchronously and can take minutes for a
      // real model; the tree shouldn't wait for it. linkPendingModels() (polled
      // by the project page) attaches the model once it's done.
      glbQueued = this.enqueueGlbInBackground(inPath, originalName, project.name, organizationId, projectId, importFile.id);
      modelId = null;

      importFile.status = ImportFileStatus.COMPLETED;
      importFile.nodeCount = nodeCount;
      await this.importRepo.save(importFile);

      this.logger.log(`Imported ${nodeCount} nodes from ${originalName} (GLB ${glbQueued ? 'converting in background' : 'not queued'})`);
      return { importFileId: importFile.id, nodeCount, counts: result.counts, modelId, glbQueued };
    } catch (err) {
      importFile.status = ImportFileStatus.FAILED;
      importFile.error = String(err instanceof Error ? err.message : err);
      await this.importRepo.save(importFile);
      throw err;
    } finally {
      this.safeUnlink(inPath);
      this.safeUnlink(outPath);
    }
  }

  /**
   * Link models produced by queued conversions back to their import's nodes.
   * Called when a project is opened so GLBs appear once the worker finishes.
   */
  async linkPendingModels(projectId: string): Promise<{ linked: number; pending: number; failed: number }> {
    const organizationId = TenantContext.requireOrganizationId();
    const imports = await this.importRepo.find({ where: { organizationId, projectId } });
    let linked = 0;
    let pending = 0;
    let failed = 0;
    for (const imp of imports) {
      if (imp.modelId) continue;
      if (!imp.conversionJobId) {
        // Background conversion hasn't registered its job yet (or failed before it could).
        if (imp.status === ImportFileStatus.COMPLETED) { imp.error ? failed++ : pending++; }
        continue;
      }
      let job;
      try { job = await this.conversionService.findOne(imp.conversionJobId); } catch { continue; }
      if (job.status === 'completed' && job.modelId) {
        imp.modelId = job.modelId;
        await this.importRepo.save(imp);
        await this.nodeRepo.update({ organizationId, projectId, importFileId: imp.id }, { modelId: job.modelId });
        linked++;
      } else if (job.status === 'failed') {
        failed++;
      } else {
        pending++;
      }
    }
    return { linked, pending, failed };
  }

  /**
   * Kick the IFC->GLB conversion in the BACKGROUND (fire-and-forget): on the
   * inline (no-Redis) queue, createJob converts synchronously and can take
   * minutes on a real model — the import response must not wait for it. Copies
   * the source to its own temp file (the import's temp file is deleted when the
   * request returns) and links/marks the ImportFile when the job finishes.
   * Returns true when the background job was started.
   */
  private enqueueGlbInBackground(
    ifcPath: string,
    originalName: string,
    projectName: string,
    organizationId: string,
    projectId: string,
    importFileId: string,
  ): boolean {
    let bgPath: string;
    try {
      bgPath = path.join(os.tmpdir(), 'pcs-ifc-import', `${crypto.randomUUID()}.ifc`);
      fs.copyFileSync(ifcPath, bgPath);
    } catch (e) {
      this.logger.warn(`Could not stage GLB conversion for ${originalName}: ${e instanceof Error ? e.message : e}`);
      return false;
    }
    void (async () => {
      try {
        const stats = fs.statSync(bgPath);
        const base = path.basename(originalName, path.extname(originalName));
        const file = this.asMulterFile(bgPath, originalName, stats.size, 'application/octet-stream');
        const job = await this.conversionService.createJob(
          { name: projectName || base, description: `Imported from ${originalName}`, modelType: 'assembly' },
          file,
        );
        const imp = await this.importRepo.findOne({ where: { id: importFileId } });
        if (imp) {
          imp.conversionJobId = job.id;
          if (job.status === 'completed' && job.modelId) {
            imp.modelId = job.modelId;
            await this.nodeRepo.update({ organizationId, projectId, importFileId }, { modelId: job.modelId });
          }
          await this.importRepo.save(imp);
        }
        this.logger.log(`GLB conversion ${job.status} (job ${job.id}) for ${originalName}`);
      } catch (e) {
        this.logger.warn(`Background GLB conversion failed for ${originalName}: ${e instanceof Error ? e.message : e}`);
        try {
          const imp = await this.importRepo.findOne({ where: { id: importFileId } });
          if (imp && !imp.modelId) {
            imp.error = `GLB conversion failed: ${e instanceof Error ? e.message : String(e)}`;
            await this.importRepo.save(imp);
          }
        } catch { /* best effort */ }
      } finally {
        this.safeUnlink(bgPath);
      }
    })();
    return true;
  }

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
   * rather than duplicates.
   */
  private async persistTree(
    organizationId: string,
    projectId: string,
    importFileId: string,
    format: string,
    nodes: ExtractedNode[],
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

  private safeUnlink(p: string): void {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
  }
}
