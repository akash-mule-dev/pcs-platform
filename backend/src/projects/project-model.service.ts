import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { AssemblyNode } from './assembly-node.entity.js';
import { ModelsService } from '../models/models.service.js';
import { extractPartGlb } from './part-glb.util.js';

export interface NodePartGlb {
  data: Buffer;
  isolated: boolean; // false when we streamed the full model (nothing to isolate)
  meshCount: number;
  fileName: string;
}

/**
 * Builds an isolated GLB for one assembly node by carving it out of the stored
 * project GLB. Reads are PUBLIC (no tenant scoping) to match GET
 * /api/models/:id/file — a per-part GLB is a subset of an already-public model,
 * addressed by unguessable UUIDs. Extracted GLBs are cached on disk (keyed by
 * model + isolation set) so repeat web requests don't re-extract.
 */
@Injectable()
export class ProjectModelService {
  constructor(
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    private readonly models: ModelsService,
  ) {}

  async getNodePartGlb(projectId: string, nodeId: string): Promise<NodePartGlb> {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, projectId } });
    if (!node) throw new NotFoundException('Assembly node not found');
    if (!node.modelId) {
      throw new NotFoundException('No 3D model is linked to this node yet (still converting or not imported).');
    }

    const meshNames = await this.collectMeshNames(projectId, node);
    const safeMark = ((node.mark || node.name || 'part').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40)) || 'part';
    const fileName = `${safeMark}.glb`;

    const hash = hashNames(meshNames);
    const cacheDir = path.join(os.tmpdir(), 'pcs-part-glb');
    const cacheFile = path.join(cacheDir, `${node.modelId}__${hash}.glb`);

    // Cache hit (only isolated results are cached).
    if (meshNames.length > 0) {
      try {
        const cached = await fs.promises.readFile(cacheFile);
        return { data: cached, isolated: true, meshCount: meshNames.length, fileName };
      } catch {
        /* miss → compute below */
      }
    }

    // Load the full project GLB once.
    const { stream } = await this.models.getFileStream(node.modelId);
    const fullBytes = await streamToBuffer(stream);

    // No geometry to isolate (e.g. a structural group) → return the full model.
    if (meshNames.length === 0) {
      return { data: fullBytes, isolated: false, meshCount: 0, fileName };
    }

    const res = await extractPartGlb(new Uint8Array(fullBytes), meshNames);
    if (res.meshCount === 0) {
      return { data: fullBytes, isolated: false, meshCount: 0, fileName };
    }

    const out = Buffer.from(res.data);
    try {
      await fs.promises.mkdir(cacheDir, { recursive: true });
      await fs.promises.writeFile(cacheFile, out);
    } catch {
      /* caching is best-effort */
    }
    return { data: out, isolated: true, meshCount: res.meshCount, fileName };
  }

  /** A node's own mesh plus every descendant's (containers carry no geometry). */
  private async collectMeshNames(projectId: string, node: AssemblyNode): Promise<string[]> {
    const names = new Set<string>();
    const own = node.meshName || node.ifcGuid;
    if (own) names.add(own);
    let frontier = [node.id];
    while (frontier.length) {
      const kids = await this.nodeRepo.find({ where: { projectId, parentId: In(frontier) } });
      if (!kids.length) break;
      for (const k of kids) {
        const m = k.meshName || k.ifcGuid;
        if (m) names.add(m);
      }
      frontier = kids.map((k) => k.id);
    }
    return [...names];
  }
}

// Stable short key for the isolation set → names the disk cache file.
function hashNames(names: string[]): string {
  const s = [...names].sort().join('');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer | string) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
