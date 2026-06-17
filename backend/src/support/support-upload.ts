import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  SUPPORT_ATTACH_EXTENSIONS, SUPPORT_ATTACH_MAX_BYTES, SUPPORT_ATTACH_MIME_TYPES,
} from './support-attachments.constants.js';

// Transient staging dir for multipart uploads; the storage provider then moves
// the bytes to their final tenant-partitioned object-store key.
const STAGING_DIR = path.join(os.tmpdir(), 'pcs-support-uploads');

/**
 * Shared multer config for support attachments (customer + desk). The staging
 * filename is a random UUID — NEVER derived from the client `originalname` — so a
 * crafted `filename="../../x"` part cannot escape STAGING_DIR (path traversal /
 * arbitrary write). The `fileFilter` rejects non image/PDF uploads before they
 * are written to disk, and the size cap bounds disk I/O.
 */
export const supportAttachmentMulter = {
  storage: diskStorage({
    destination: (_req: any, _file: any, cb: any) => {
      if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });
      cb(null, STAGING_DIR);
    },
    filename: (_req: any, file: any, cb: any) =>
      cb(null, `${crypto.randomUUID()}${(path.extname(file.originalname) || '').toLowerCase()}`),
  }),
  fileFilter: (_req: any, file: any, cb: any) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    const ok = SUPPORT_ATTACH_MIME_TYPES.includes((file.mimetype || '').toLowerCase())
      && SUPPORT_ATTACH_EXTENSIONS.includes(ext);
    cb(ok ? null : new BadRequestException('Attachment must be a JPEG, PNG, WebP image or a PDF'), ok);
  },
  limits: { fileSize: SUPPORT_ATTACH_MAX_BYTES },
};

/**
 * Pipe a storage download stream to the HTTP response, tearing the response down
 * on a mid-stream storage error (which fires AFTER headers are sent, so a plain
 * try/catch can't catch it — the client would otherwise hang).
 */
export function streamToResponse(stream: NodeJS.ReadableStream, res: any, contentType: string): void {
  res.set({ 'Content-Type': contentType, 'Cache-Control': 'private, max-age=3600' });
  (stream as any).on('error', () => { try { res.destroy(); } catch { /* already closed */ } });
  (stream as any).pipe(res);
}
