import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { LibraryService } from './library.service.js';

/**
 * Ensures the platform library organization and its default content exist on
 * every boot (idempotent). Runs at application bootstrap, after the schema is
 * in place and system roles are seeded.
 */
@Injectable()
export class LibraryBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LibraryBootstrapService.name);

  constructor(private readonly library: LibraryService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.library.ensurePlatformOrgAndDefaults();
    } catch (e) {
      // Never block boot on library seeding (e.g. first boot racing schema sync).
      this.logger.error(`Library bootstrap skipped: ${(e as Error).message}`);
    }
  }
}
