import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { AssemblyDocument } from './assembly-document.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { STORAGE_PROVIDER } from '../storage/storage.interface.js';
import type { StorageProvider } from '../storage/storage.interface.js';

const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 20 * 1024 * 1024;

/** Shop drawings & co. per assembly node, stored via the StorageProvider. */
@Injectable()
export class ProjectDocumentService {
  constructor(
    @InjectRepository(AssemblyDocument) private readonly docRepo: Repository<AssemblyDocument>,
    @InjectRepository(AssemblyNode) private readonly nodeRepo: Repository<AssemblyNode>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private async assertNode(projectId: string, nodeId: string, org: string): Promise<AssemblyNode> {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, projectId, organizationId: org } });
    if (!node) throw new NotFoundException('Assembly node not found');
    return node;
  }

  async list(projectId: string, nodeId: string): Promise<AssemblyDocument[]> {
    const org = TenantContext.requireOrganizationId();
    await this.assertNode(projectId, nodeId, org);
    return this.docRepo.find({ where: { organizationId: org, projectId, nodeId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Project-wide document list (optionally one package's contents) with the
   * matched piece mark — the Monitoring "package contents" view.
   */
  async listForProject(projectId: string, importFileId?: string) {
    const org = TenantContext.requireOrganizationId();
    const params: any[] = [org, projectId];
    let where = 'd.organization_id = $1 AND d.project_id = $2';
    if (importFileId) { params.push(importFileId); where += ` AND d.import_file_id = $${params.length}`; }
    return this.docRepo.query(
      `SELECT d.id, d.node_id, d.import_file_id, d.original_name, d.content_type, d.size,
              d.label, d.created_by_name, d.created_at, n.mark AS node_mark, n.name AS node_name
         FROM assembly_documents d
         LEFT JOIN assembly_nodes n ON n.id = d.node_id
        WHERE ${where}
        ORDER BY d.created_at DESC
        LIMIT 1000`,
      params,
    );
  }

  async upload(
    projectId: string,
    nodeId: string,
    file: Express.Multer.File,
    label?: string,
    user?: { id?: string; email?: string; firstName?: string; lastName?: string },
  ): Promise<AssemblyDocument> {
    const org = TenantContext.requireOrganizationId();
    await this.assertNode(projectId, nodeId, org);
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED.has(file.mimetype)) throw new BadRequestException('Only PDF, PNG, JPEG or WebP documents are accepted');
    if (file.size > MAX_BYTES) throw new BadRequestException('Document exceeds the 20 MB limit');

    const ext = path.extname(file.originalname) || (file.mimetype === 'application/pdf' ? '.pdf' : '.bin');
    const key = `assembly-docs/${crypto.randomUUID()}${ext}`;

    // Storage uploads from a path; multer may give us a buffer (memory storage).
    let srcPath = file.path;
    let staged: string | null = null;
    if (!srcPath) {
      staged = path.join(os.tmpdir(), `pcs-doc-${crypto.randomUUID()}${ext}`);
      fs.writeFileSync(staged, file.buffer);
      srcPath = staged;
    }
    try {
      await this.storage.upload(srcPath, key, file.mimetype);
    } finally {
      if (staged) { try { fs.unlinkSync(staged); } catch { /* ignore */ } }
    }

    const createdByName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || null;
    return this.docRepo.save(this.docRepo.create({
      organizationId: org,
      projectId,
      nodeId,
      originalName: file.originalname,
      contentType: file.mimetype,
      size: file.size,
      storageKey: key,
      label: label?.trim() || null,
      createdById: user?.id ?? null,
      createdByName,
    }));
  }

  /** Stream a document (authed; the controller sets the headers). */
  async open(projectId: string, docId: string): Promise<{ doc: AssemblyDocument; stream: NodeJS.ReadableStream }> {
    const org = TenantContext.requireOrganizationId();
    const doc = await this.docRepo.findOne({ where: { id: docId, projectId, organizationId: org } });
    if (!doc) throw new NotFoundException('Document not found');
    const stream = await this.storage.download(doc.storageKey);
    return { doc, stream };
  }

  async remove(projectId: string, docId: string): Promise<{ ok: true }> {
    const org = TenantContext.requireOrganizationId();
    const doc = await this.docRepo.findOne({ where: { id: docId, projectId, organizationId: org } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.docRepo.remove(doc);
    try { await this.storage.delete(doc.storageKey); } catch { /* metadata removed; orphan file is harmless */ }
    return { ok: true };
  }
}
