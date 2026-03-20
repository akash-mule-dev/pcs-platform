export interface StorageProvider {
  /**
   * Upload a file to storage and return the storage key.
   */
  upload(filePath: string, key: string, mimeType: string): Promise<string>;

  /**
   * Download a file from storage and return a readable stream.
   */
  download(key: string): Promise<NodeJS.ReadableStream>;

  /**
   * Delete a file from storage.
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists in storage.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get a public/signed URL for a file (if supported).
   */
  getUrl(key: string): Promise<string | null>;
}

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';
