import { Injectable, Logger } from '@nestjs/common';
import { StorageProvider } from '../storage.interface.js';
import {
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import * as fs from 'fs';

@Injectable()
export class AzureBlobStorageProvider implements StorageProvider {
  private readonly logger = new Logger(AzureBlobStorageProvider.name);
  private readonly containerClient: ContainerClient;
  private readonly prefix: string;

  constructor() {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const accountName = process.env.AZURE_STORAGE_ACCOUNT;
    const accountKey = process.env.AZURE_STORAGE_KEY;
    const containerName = process.env.AZURE_STORAGE_CONTAINER || 'pcs-models';
    this.prefix = process.env.AZURE_STORAGE_PREFIX || 'models/';

    let blobServiceClient: BlobServiceClient;

    if (connectionString) {
      blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    } else if (accountName && accountKey) {
      const credential = new StorageSharedKeyCredential(accountName, accountKey);
      blobServiceClient = new BlobServiceClient(
        `https://${accountName}.blob.core.windows.net`,
        credential,
      );
    } else {
      throw new Error(
        'Azure Blob Storage requires AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_KEY',
      );
    }

    this.containerClient = blobServiceClient.getContainerClient(containerName);
    this.ensureContainer();

    this.logger.log(`Azure Blob storage initialized: container=${containerName}, prefix=${this.prefix}`);
  }

  private async ensureContainer(): Promise<void> {
    try {
      await this.containerClient.createIfNotExists();
    } catch (err) {
      this.logger.warn(`Could not ensure container exists: ${err}`);
    }
  }

  private fullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async upload(filePath: string, key: string, mimeType: string): Promise<string> {
    const blobClient = this.containerClient.getBlockBlobClient(this.fullKey(key));
    const fileStream = fs.createReadStream(filePath);
    const fileSize = fs.statSync(filePath).size;

    await blobClient.uploadStream(fileStream, undefined, undefined, {
      blobHTTPHeaders: { blobContentType: mimeType || 'application/octet-stream' },
    });

    // Clean up temp file after upload
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    this.logger.log(`Uploaded to Azure Blob: ${this.fullKey(key)} (${fileSize} bytes)`);
    return key;
  }

  async download(key: string): Promise<NodeJS.ReadableStream> {
    const blobClient = this.containerClient.getBlockBlobClient(this.fullKey(key));
    const response = await blobClient.download(0);

    if (!response.readableStreamBody) {
      throw new Error(`Failed to download blob: ${key}`);
    }

    return response.readableStreamBody;
  }

  async delete(key: string): Promise<void> {
    const blobClient = this.containerClient.getBlockBlobClient(this.fullKey(key));
    await blobClient.deleteIfExists();
    this.logger.log(`Deleted from Azure Blob: ${this.fullKey(key)}`);
  }

  async exists(key: string): Promise<boolean> {
    const blobClient = this.containerClient.getBlockBlobClient(this.fullKey(key));
    return blobClient.exists();
  }

  async getUrl(key: string): Promise<string | null> {
    const blobClient = this.containerClient.getBlockBlobClient(this.fullKey(key));
    // Returns the blob URL (requires public access or SAS token for actual access)
    return blobClient.url;
  }
}
