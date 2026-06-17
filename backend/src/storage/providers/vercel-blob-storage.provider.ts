import { Injectable, Logger } from '@nestjs/common';
import { StorageProvider } from '../storage.interface.js';
import { put, get, head, del, type BlobAccessType } from '@vercel/blob';
import { Readable } from 'node:stream';
import * as fs from 'fs';

/**
 * Vercel Blob storage provider.
 *
 * Durable object storage on Vercel Blob — the production target for every file
 * the platform persists: import sources (IFC/ZIP packages), the GLBs the
 * conversion pipeline produces, package documents (shop drawings), model
 * thumbnails and quality evidence. Packages are blobs, so they live here, never
 * in Postgres (Neon only ever stores the `storage_key` pointer).
 *
 * Keyed by PATHNAME, identical to the Azure provider: callers persist the
 * bare key they pass in (`import-sources/<id>.ifc`, `<uuid>.glb`, …) and every
 * operation addresses the blob by that pathname. The SDK resolves the store
 * from the token, so reads/deletes need no stored URL — `get`/`head`/`del` all
 * take a pathname directly. `addRandomSuffix: false` keeps the blob pathname
 * equal to the key (no random suffix to track).
 *
 * The PCS dev store is configured for PRIVATE access: blobs are not publicly
 * fetchable, so files are streamed back through the API (the existing
 * `download → pipe` endpoints) using the server-side token — never exposed via
 * a public URL. Override with `BLOB_ACCESS=public` for a public store.
 *
 * Auth token resolution (first non-empty wins): PCS_DEV_BLOB_READ_WRITE_TOKEN →
 * PCS_BLOB_READ_WRITE_TOKEN → BLOB_READ_WRITE_TOKEN (the Vercel default). The
 * token is passed explicitly on every call so a custom env name works.
 */
@Injectable()
export class VercelBlobStorageProvider implements StorageProvider {
  private readonly logger = new Logger(VercelBlobStorageProvider.name);
  private readonly token: string;
  private readonly prefix: string;
  private readonly access: BlobAccessType;
  /** Files larger than this are streamed in parts (multipart) instead of buffered. */
  private readonly multipartThreshold = Math.max(
    1,
    Number(process.env.BLOB_MULTIPART_THRESHOLD) || 16 * 1024 * 1024,
  );

  constructor() {
    this.token =
      process.env.PCS_DEV_BLOB_READ_WRITE_TOKEN ||
      process.env.PCS_BLOB_READ_WRITE_TOKEN ||
      process.env.BLOB_READ_WRITE_TOKEN ||
      '';
    this.prefix = (process.env.BLOB_PREFIX || '').replace(/^\/+|\/+$/g, '');
    this.access = (process.env.BLOB_ACCESS || 'private').toLowerCase() === 'public' ? 'public' : 'private';
    if (!this.token) {
      throw new Error(
        'Vercel Blob storage requires a read/write token ' +
          '(PCS_DEV_BLOB_READ_WRITE_TOKEN, PCS_BLOB_READ_WRITE_TOKEN or BLOB_READ_WRITE_TOKEN)',
      );
    }
    this.logger.log(
      `Vercel Blob storage initialized (access=${this.access}${this.prefix ? `, prefix=${this.prefix}/` : ''})`,
    );
  }

  private fullKey(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  async upload(filePath: string, key: string, mimeType: string): Promise<string> {
    const size = fs.statSync(filePath).size;
    const large = size > this.multipartThreshold;
    // Small files: a single PUT with a Buffer (simple, reliable). Large files:
    // a streamed multipart upload so we never hold the whole file in memory.
    const body = large ? fs.createReadStream(filePath) : fs.readFileSync(filePath);
    await this.putBlob(key, body, mimeType, size, large);
    // Mirror the Azure provider: the source temp file is no longer needed.
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* best-effort cleanup */
    }
    return key;
  }

  async uploadBuffer(data: Buffer, key: string, mimeType: string): Promise<string> {
    const large = data.length > this.multipartThreshold;
    await this.putBlob(key, data, mimeType, data.length, large);
    return key;
  }

  /** Single PUT path shared by upload()/uploadBuffer(). */
  private async putBlob(
    key: string,
    body: Buffer | NodeJS.ReadableStream,
    mimeType: string,
    size: number,
    multipart: boolean,
  ): Promise<void> {
    const pathname = this.fullKey(key);
    await put(pathname, body as any, {
      access: this.access,
      token: this.token,
      addRandomSuffix: false, // pathname === key
      allowOverwrite: true, // retries / stable keys (thumbnails) re-upload the same path
      contentType: mimeType || 'application/octet-stream',
      multipart,
    });
    this.logger.log(`Uploaded to Vercel Blob: ${pathname} (${size} bytes)`);
  }

  async download(key: string): Promise<NodeJS.ReadableStream> {
    // `get` resolves the store from the token and streams the blob by pathname;
    // for a private store this is the only authenticated way to read it.
    const result = await get(this.fullKey(key), { access: this.access, token: this.token });
    if (!result || !result.stream) {
      throw new Error(`Vercel Blob: blob not found for ${key}`);
    }
    return Readable.fromWeb(result.stream as any);
  }

  async delete(key: string): Promise<void> {
    const pathname = this.fullKey(key);
    await del(pathname, { token: this.token });
    this.logger.log(`Deleted from Vercel Blob: ${pathname}`);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await head(this.fullKey(key), { token: this.token });
      return true;
    } catch {
      return false;
    }
  }

  async getUrl(key: string): Promise<string | null> {
    // The canonical blob URL. On a private store it still requires the token to
    // fetch, so files are served through the API (download → pipe), not this URL.
    try {
      const meta = await head(this.fullKey(key), { token: this.token });
      return meta.url;
    } catch {
      return null;
    }
  }
}
