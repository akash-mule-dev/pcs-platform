import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { Project } from './project.entity.js';
import { AssemblyNode, AssemblyNodeType } from './assembly-node.entity.js';
import { ImportFile, ImportFileStatus } from './import-file.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { CadConversionService } from '../cad-conversion/cad-conversion.service.js';
import { ModelsService } from '../models/models.service.js';

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

// Above this size we skip the synchronous GLB build (do those via the async
// conversion pipeline); the structure tree is still imported.
const GLB_MAX_BYTES = 80 * 1024 * 1024;

@Injectable()
export class IfcImportService {
  private readonly logger = new Logger(IfcImportService.name);
  // dist/projects -> dist/cad-conversion/scripts/extract-ifc-structure.mjs
  private readonly scriptPath = path.join(__dirname, '..', 'cad-conversion', 'scripts', 'extract-ifc-structure.mjs');

  constructor(
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @InjectRepository(ImportFile) private readonly importRepo: Repository<ImportFile>,
    private readonly cadService: CadConversionService,
    private readonly modelsService: ModelsService,
  ) {}

  /**
   * Import an IFC file into a project: extract its structure into `assembly_nodes`
   * (idempotent by ifc_guid) and, best-effort, also build a GLB so the tree can be
   * viewed/highlighted in 3D (GLB nodes are named by GlobalId == ifc_guid).
   */
  async importIfc(
    projectId: string,
    originalName: string,
    data: Buffer,
  ): Promise<{ importFileId: string; nodeCount: number; counts: Record<string, number>; modelId: string | null }> {
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
    try {
      await this.runExtractor(inPath, outPath);
      const result = JSON.parse(fs.readFileSync(outPath, 'utf8')) as ExtractResult;
      const nodeCount = await this.persistTree(organizationId, projectId, importFile.id, format, result.nodes);

      // Best-effort GLB build + link (skipped for very large files).
      if (data.length <= GLB_MAX_BYTES) {
        modelId = await this.buildAndLinkGlb(inPath, originalName, project.name, organizationId, projectId, importFile.id);
      } else {
        this.logger.log(`Skipped synchronous GLB for large file ${originalName} (${data.length} bytes)`);
      }

      importFile.status = ImportFileStatus.COMPLETED;
      importFile.nodeCount = nodeCount;
      importFile.modelId = modelId;
      await this.importRepo.save(importFile);

      this.logger.log(`Imported ${nodeCount} nodes from ${originalName} into project ${projectId} (model=${modelId ?? 'none'})`);
      return { importFileId: importFile.id, nodeCount, counts: result.counts, modelId };
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

  /** Convert IFC -> GLB, store it as a Model3D, and stamp modelId on the import's nodes. */
  private async buildAndLinkGlb(
    ifcPath: string,
    originalName: string,
    projectName: string,
    organizationId: string,
    projectId: string,
    importFileId: string,
  ): Promise<string | null> {
    try {
      const glb = await this.cadService.convert(ifcPath, originalName);
      if (!glb.success || !glb.outputPath) {
        this.logger.warn(`GLB build skipped for ${originalName}: ${glb.error ?? 'no output'}`);
        return null;
      }
      const stats = fs.statSync(glb.outputPath);
      const base = path.basename(originalName, path.extname(originalName));
      const file = {
        fieldname: 'file',
        originalname: `${base}.glb`,
        encoding: '7bit',
        mimetype: 'model/gltf-binary',
        size: stats.size,
        destination: path.dirname(glb.outputPath),
        filename: `${crypto.randomUUID()}.glb`,
        path: glb.outputPath,
        buffer: Buffer.alloc(0),
        stream: fs.createReadStream(glb.outputPath),
      } as Express.Multer.File;

      const model = await this.modelsService.create(
        { name: projectName || base, description: `Imported from ${originalName}`, modelType: 'assembly' },
        file,
      );
      await this.nodeRepo.update(
        { organizationId, projectId, importFileId },
        { modelId: model.id },
      );
      this.cadService.cleanup(glb.outputPath);
      return model.id;
    } catch (e) {
      this.logger.warn(`GLB generation failed for ${originalName} (structure still imported): ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /**
   * Upsert the extracted nodes. They arrive in DFS pre-order, so a parent is
   * always persisted before its children and its DB id is available for the
   * child's parent_id. Idempotent: an existing node (same ifc_guid in the
   * project) is updated in place, so re-importing a revised IFC won't duplicate.
   */
  private async persistTree(
    organizationId: string,
    projectId: string,
    importFileId: string,
    format: string,
    nodes: ExtractedNode[],
  ): Promise<number> {
    const idByExternal = new Map<string, string>();
    let count = 0;

    for (const n of nodes) {
      const existing = await this.nodeRepo.findOne({
        where: { organizationId, projectId, ifcGuid: n.externalId },
      });
      const entity = existing ?? this.nodeRepo.create();
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
      const saved = await this.nodeRepo.save(entity);
      idByExternal.set(n.externalId, saved.id);
      count++;
    }
    return count;
  }

  private runExtractor(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['--max-old-space-size=4096', this.scriptPath, inputPath, outputPath], {
        timeout: 300_000, // 5 min for large models
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
