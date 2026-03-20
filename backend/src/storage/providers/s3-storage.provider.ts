import { Injectable, Logger } from '@nestjs/common';
import { StorageProvider } from '../storage.interface.js';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET || 'pcs-models';
    this.prefix = process.env.S3_PREFIX || 'models/';

    this.client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.S3_ENDPOINT && {
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: true,
      }),
      ...(process.env.AWS_ACCESS_KEY_ID && {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
      }),
    });

    this.logger.log(`S3 storage initialized: bucket=${this.bucket}, prefix=${this.prefix}`);
  }

  private fullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async upload(filePath: string, key: string, mimeType: string): Promise<string> {
    const fileStream = fs.createReadStream(filePath);
    const fullKey = this.fullKey(key);

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: fullKey,
      Body: fileStream,
      ContentType: mimeType || 'application/octet-stream',
    }));

    // Clean up temp file after upload
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    this.logger.log(`Uploaded to S3: ${fullKey}`);
    return key;
  }

  async download(key: string): Promise<NodeJS.ReadableStream> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.fullKey(key),
    }));

    return result.Body as NodeJS.ReadableStream;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this.fullKey(key),
    }));
    this.logger.log(`Deleted from S3: ${this.fullKey(key)}`);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.fullKey(key),
      }));
      return true;
    } catch {
      return false;
    }
  }

  async getUrl(key: string): Promise<string | null> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.fullKey(key),
    });
    return getSignedUrl(this.client, command, { expiresIn: 3600 });
  }
}
