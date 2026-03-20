import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as unzipper from 'unzipper';
import { CoordinationPackage } from './coordination-package.entity.js';
import { Drawing } from './drawing.entity.js';
import { ModelsService } from '../models/models.service.js';
import { CadConversionService } from '../cad-conversion/cad-conversion.service.js';
import type { StorageProvider } from '../storage/storage.interface.js';
import { STORAGE_PROVIDER } from '../storage/storage.interface.js';
import { EventsGateway } from '../websocket/events.gateway.js';

const EXTRACT_DIR = path.join(os.tmpdir(), 'pcs-coordination');

@Injectable()
export class CoordinationService {
  private readonly logger = new Logger(CoordinationService.name);

  constructor(
    @InjectRepository(CoordinationPackage)
    private readonly pkgRepo: Repository<CoordinationPackage>,
    @InjectRepository(Drawing)
    private readonly drawingRepo: Repository<Drawing>,
    private readonly modelsService: ModelsService,
    private readonly cadService: CadConversionService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly ws: EventsGateway,
  ) {
    if (!fs.existsSync(EXTRACT_DIR)) fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  }

  // ── Queries ────────────────────────────────────────────────────────────

  async findAll(): Promise<CoordinationPackage[]> {
    return this.pkgRepo.find({
      relations: ['model'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<CoordinationPackage> {
    const pkg = await this.pkgRepo.findOne({
      where: { id },
      relations: ['model'],
    });
    if (!pkg) throw new NotFoundException('Coordination package not found');
    return pkg;
  }

  async getDrawings(packageId: string): Promise<Drawing[]> {
    const pkg = await this.findOne(packageId);
    if (!pkg.modelId) return [];
    return this.drawingRepo.find({
      where: { modelId: pkg.modelId },
      order: { drawingType: 'ASC', drawingNumber: 'ASC' },
    });
  }

  async getDrawingFile(drawingId: string) {
    const drawing = await this.drawingRepo.findOne({ where: { id: drawingId } });
    if (!drawing) throw new NotFoundException('Drawing not found');
    const stream = await this.storage.download(drawing.fileName);
    return { stream, drawing };
  }

  // ── ZIP upload processing ──────────────────────────────────────────────

  async processZipUpload(
    file: Express.Multer.File,
    name: string,
    description?: string,
  ): Promise<CoordinationPackage> {
    // Create the package record upfront with 'processing' status
    const pkg = this.pkgRepo.create({
      name,
      description: description || null,
      sourceFile: file.originalname,
      status: 'processing',
    });
    const saved = await this.pkgRepo.save(pkg);

    // Process async — don't block the HTTP response
    this.processPackageAsync(saved.id, file.path).catch((err) => {
      this.logger.error(`Package processing failed: ${err}`);
    });

    return saved;
  }

  async processDirectoryUpload(
    ifcFile: Express.Multer.File,
    drawingFiles: Express.Multer.File[],
    kssFile: Express.Multer.File | undefined,
    name: string,
    description?: string,
  ): Promise<CoordinationPackage> {
    const pkg = this.pkgRepo.create({
      name,
      description: description || null,
      sourceFile: ifcFile.originalname,
      status: 'processing',
    });
    const saved = await this.pkgRepo.save(pkg);

    this.processFilesAsync(saved.id, ifcFile, drawingFiles, kssFile).catch((err) => {
      this.logger.error(`Package processing failed: ${err}`);
    });

    return saved;
  }

  // ── Private processing ─────────────────────────────────────────────────

  private async processPackageAsync(packageId: string, zipPath: string) {
    const extractDir = path.join(EXTRACT_DIR, crypto.randomUUID());

    try {
      this.emit(packageId, 'extracting', 'Extracting ZIP archive...');

      // Extract ZIP
      await this.extractZip(zipPath, extractDir);

      // Discover files
      const files = this.discoverFiles(extractDir);
      this.logger.log(
        `Discovered: ${files.ifcFiles.length} IFC, ${files.pdfFiles.length} PDFs, ${files.kssFiles.length} KSS`,
      );

      if (files.ifcFiles.length === 0) {
        await this.markError(packageId, 'No IFC file found in the archive');
        return;
      }

      // Process IFC → GLB
      this.emit(packageId, 'converting', 'Converting IFC model to 3D viewer format...');
      const ifcPath = files.ifcFiles[0];
      const convResult = await this.cadService.convert(ifcPath, path.basename(ifcPath));

      if (!convResult.success) {
        await this.markError(packageId, `IFC conversion failed: ${convResult.error}`);
        return;
      }

      // Save the converted GLB as a Model3D
      const glbStats = fs.statSync(convResult.outputPath);
      const glbFilename = `${crypto.randomUUID()}.glb`;
      const modelFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: path.basename(ifcPath, '.ifc') + '.glb',
        encoding: '7bit',
        mimetype: 'model/gltf-binary',
        size: glbStats.size,
        destination: path.dirname(convResult.outputPath),
        filename: glbFilename,
        path: convResult.outputPath,
        buffer: Buffer.alloc(0),
        stream: fs.createReadStream(convResult.outputPath),
      };

      const ifcBaseName = path.basename(ifcPath, '.ifc');
      const model = await this.modelsService.create(
        { name: ifcBaseName, description: `Converted from ${path.basename(ifcPath)}`, modelType: 'assembly' },
        modelFile,
      );

      this.cadService.cleanup(convResult.outputPath);

      // Parse KSS if present
      let kssData: Record<string, unknown> | null = null;
      if (files.kssFiles.length > 0) {
        this.emit(packageId, 'parsing_kss', 'Parsing KSS structural data...');
        kssData = this.parseKssFile(files.kssFiles[0]);
      }

      // Upload PDFs as Drawings
      this.emit(packageId, 'uploading_drawings', `Uploading ${files.pdfFiles.length} drawings...`);
      const { detailCount, erectionCount } = await this.uploadDrawings(files.pdfFiles, model.id, ifcBaseName);

      // Detect project name from IFC filename or KSS
      const projectName = this.detectProjectName(ifcPath, kssData);

      // Update the package record
      const pkgToUpdate = await this.pkgRepo.findOneBy({ id: packageId });
      if (pkgToUpdate) {
        pkgToUpdate.modelId = model.id;
        pkgToUpdate.projectName = projectName;
        pkgToUpdate.kssFileName = files.kssFiles.length > 0 ? path.basename(files.kssFiles[0]) : null;
        pkgToUpdate.kssData = kssData;
        pkgToUpdate.detailDrawingCount = detailCount;
        pkgToUpdate.erectionDrawingCount = erectionCount;
        pkgToUpdate.status = 'ready';
        await this.pkgRepo.save(pkgToUpdate);
      }

      this.emit(packageId, 'ready', 'Coordination package is ready');
      this.logger.log(`Package ${packageId} processed: model=${model.id}, ${detailCount} detail + ${erectionCount} erection drawings`);
    } catch (err) {
      this.logger.error(`Package processing error: ${err}`);
      await this.markError(packageId, String(err));
    } finally {
      // Cleanup extracted files
      this.cleanupDir(extractDir);
      this.cadService.cleanup(zipPath);
    }
  }

  private async processFilesAsync(
    packageId: string,
    ifcFile: Express.Multer.File,
    drawingFiles: Express.Multer.File[],
    kssFile?: Express.Multer.File,
  ) {
    try {
      this.emit(packageId, 'converting', 'Converting IFC model to 3D viewer format...');
      const convResult = await this.cadService.convert(ifcFile.path, ifcFile.originalname);

      if (!convResult.success) {
        await this.markError(packageId, `IFC conversion failed: ${convResult.error}`);
        return;
      }

      const glbStats = fs.statSync(convResult.outputPath);
      const modelFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: path.basename(ifcFile.originalname, '.ifc') + '.glb',
        encoding: '7bit',
        mimetype: 'model/gltf-binary',
        size: glbStats.size,
        destination: path.dirname(convResult.outputPath),
        filename: `${crypto.randomUUID()}.glb`,
        path: convResult.outputPath,
        buffer: Buffer.alloc(0),
        stream: fs.createReadStream(convResult.outputPath),
      };

      const ifcBaseName = path.basename(ifcFile.originalname, '.ifc');
      const model = await this.modelsService.create(
        { name: ifcBaseName, description: `Converted from ${ifcFile.originalname}`, modelType: 'assembly' },
        modelFile,
      );

      this.cadService.cleanup(convResult.outputPath);

      let kssData: Record<string, unknown> | null = null;
      if (kssFile) {
        kssData = this.parseKssFile(kssFile.path);
      }

      this.emit(packageId, 'uploading_drawings', `Uploading ${drawingFiles.length} drawings...`);
      const pdfPaths = drawingFiles.map((f) => f.path);
      const { detailCount, erectionCount } = await this.uploadDrawings(pdfPaths, model.id, ifcBaseName);

      const pkgToUpdate = await this.pkgRepo.findOneBy({ id: packageId });
      if (pkgToUpdate) {
        pkgToUpdate.modelId = model.id;
        pkgToUpdate.kssFileName = kssFile ? kssFile.originalname : null;
        pkgToUpdate.kssData = kssData;
        pkgToUpdate.detailDrawingCount = detailCount;
        pkgToUpdate.erectionDrawingCount = erectionCount;
        pkgToUpdate.status = 'ready';
        await this.pkgRepo.save(pkgToUpdate);
      }

      this.emit(packageId, 'ready', 'Coordination package is ready');
    } catch (err) {
      this.logger.error(`Package processing error: ${err}`);
      await this.markError(packageId, String(err));
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async extractZip(zipPath: string, destDir: string): Promise<void> {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    await fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: destDir }))
      .promise();
  }

  private discoverFiles(dir: string) {
    const ifcFiles: string[] = [];
    const pdfFiles: string[] = [];
    const kssFiles: string[] = [];

    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.ifc') ifcFiles.push(full);
          else if (ext === '.pdf') pdfFiles.push(full);
          else if (ext === '.kss') kssFiles.push(full);
        }
      }
    };
    walk(dir);
    return { ifcFiles, pdfFiles, kssFiles };
  }

  private async uploadDrawings(
    pdfPaths: string[],
    modelId: string,
    packageName: string,
  ): Promise<{ detailCount: number; erectionCount: number }> {
    let detailCount = 0;
    let erectionCount = 0;

    for (const pdfPath of pdfPaths) {
      const originalName = path.basename(pdfPath);
      const storageKey = `drawings/${crypto.randomUUID()}.pdf`;
      const stats = fs.statSync(pdfPath);

      await this.storage.upload(pdfPath, storageKey, 'application/pdf');

      // Detect drawing type from parent folder name
      const parentDir = path.basename(path.dirname(pdfPath)).toLowerCase();
      let drawingType = 'detail';
      if (parentDir.includes('erection')) {
        drawingType = 'erection';
        erectionCount++;
      } else {
        detailCount++;
      }

      // Parse drawing number & revision from filename like "B105 - Rev 1.pdf"
      const { drawingNumber, revision } = this.parseDrawingFilename(originalName);

      const drawing = this.drawingRepo.create({
        name: originalName,
        drawingNumber,
        revision,
        drawingType,
        fileName: storageKey,
        originalName,
        filePath: storageKey,
        fileSize: stats.size,
        mimeType: 'application/pdf',
        modelId,
        packageName,
      });

      await this.drawingRepo.save(drawing);
    }

    return { detailCount, erectionCount };
  }

  private parseDrawingFilename(filename: string): { drawingNumber: string | null; revision: string | null } {
    // Pattern: "B105 - Rev 1.pdf" or "E108 - Rev 2.pdf" or "AB101 - Rev 0.pdf"
    const match = filename.match(/^([A-Z]+\d+)\s*-\s*Rev\s*(\d+)/i);
    if (match) {
      return { drawingNumber: match[1], revision: match[2] };
    }
    return { drawingNumber: path.basename(filename, '.pdf'), revision: null };
  }

  private parseKssFile(kssPath: string): Record<string, unknown> | null {
    try {
      const content = fs.readFileSync(kssPath, 'utf-8');
      const lines = content.split(/\r?\n/).filter((l) => l.trim());

      // KSS files are tab/space delimited member lists from Tekla
      // Parse header + data rows
      if (lines.length < 2) return { raw: content, memberCount: 0 };

      const headers = lines[0].split(/\t/).map((h) => h.trim());
      const members: Record<string, string>[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(/\t/);
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          if (h && cols[idx] !== undefined) row[h] = cols[idx].trim();
        });
        members.push(row);
      }

      return {
        headers,
        memberCount: members.length,
        members,
      };
    } catch (err) {
      this.logger.warn(`Failed to parse KSS file: ${err}`);
      return null;
    }
  }

  private detectProjectName(
    ifcPath: string,
    kssData: Record<string, unknown> | null,
  ): string | null {
    // Try to extract from IFC filename
    const basename = path.basename(ifcPath, '.ifc');
    if (basename && basename !== 'out') return basename;
    return null;
  }

  private async markError(packageId: string, message: string) {
    await this.pkgRepo.update(packageId, {
      status: 'error',
      errorMessage: message,
    });
    this.emit(packageId, 'error', message);
  }

  private emit(packageId: string, status: string, message: string) {
    this.ws.server?.emit('coordination:progress', { packageId, status, message });
  }

  private cleanupDir(dir: string) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  async remove(id: string): Promise<void> {
    const pkg = await this.findOne(id);

    // Delete associated drawings
    const drawings = pkg.modelId
      ? await this.drawingRepo.find({ where: { modelId: pkg.modelId } })
      : [];
    for (const d of drawings) {
      await this.storage.delete(d.fileName);
      await this.drawingRepo.remove(d);
    }

    // Delete the 3D model
    if (pkg.modelId) {
      await this.modelsService.remove(pkg.modelId);
    }

    await this.pkgRepo.remove(pkg);
  }
}
