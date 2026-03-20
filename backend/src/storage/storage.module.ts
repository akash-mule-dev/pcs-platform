import { Module, Global, Logger } from '@nestjs/common';
import { STORAGE_PROVIDER } from './storage.interface.js';
import { LocalStorageProvider } from './providers/local-storage.provider.js';
import { S3StorageProvider } from './providers/s3-storage.provider.js';
import { AzureBlobStorageProvider } from './providers/azure-blob-storage.provider.js';

const logger = new Logger('StorageModule');

function createStorageProvider() {
  const storageType = (process.env.STORAGE_TYPE || 'local').toLowerCase();

  switch (storageType) {
    case 's3':
      logger.log('Using S3 storage provider');
      return new S3StorageProvider();
    case 'azure':
      logger.log('Using Azure Blob storage provider');
      return new AzureBlobStorageProvider();
    case 'local':
    default:
      logger.log('Using local disk storage provider');
      return new LocalStorageProvider();
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
