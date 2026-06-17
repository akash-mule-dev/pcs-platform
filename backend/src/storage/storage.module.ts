import { Module, Global, Logger } from '@nestjs/common';
import { STORAGE_PROVIDER } from './storage.interface.js';
import { AzureBlobStorageProvider } from './providers/azure-blob-storage.provider.js';
import { VercelBlobStorageProvider } from './providers/vercel-blob-storage.provider.js';

const logger = new Logger('StorageModule');

/**
 * Object storage is always REMOTE — there is no local-disk persistence. Every
 * blob (packages, GLBs, drawings, thumbnails, QA evidence) lives in the object
 * store selected by STORAGE_TYPE; Vercel Blob is the default.
 */
function createStorageProvider() {
  const storageType = (process.env.STORAGE_TYPE || 'vercel-blob').toLowerCase();

  switch (storageType) {
    case 'azure':
      logger.log('Using Azure Blob storage provider');
      return new AzureBlobStorageProvider();
    case 'vercel':
    case 'vercel-blob':
    case 'blob':
    default:
      logger.log('Using Vercel Blob storage provider');
      return new VercelBlobStorageProvider();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useFactory: createStorageProvider,
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
