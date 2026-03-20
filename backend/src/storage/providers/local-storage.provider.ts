import { Injectable, Logger } from '@nestjs/common';
import { StorageProvider } from '../storage.interface.js';
import * as fs from 'fs';
import * as path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'models');

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);

  constructor() {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
  }

  async upload(filePath: string, key: string, _mimeType: string): Promise<string> {
    const dest = path.join(UPLOAD_DIR, key);
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    if (filePath !== dest) {
      fs.copyFileSync(filePath, dest);
    }
    this.logger.log(`Stored file locally: ${key}`);
    return key;
  }

  async download(key: string): Promise<NodeJS.ReadableStream> {
    const filePath = path.join(UPLOAD_DIR, key);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${key}`);
    }
    return fs.createReadStream(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(UPLOAD_DIR, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.logger.log(`Deleted local file: ${key}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(path.join(UPLOAD_DIR, key));
  }

  async getUrl(key: string): Promise<string | null> {
    // Local storage doesn't have public URLs; served via API endpoint
    return null;
  }
}
