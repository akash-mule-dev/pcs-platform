import { Injectable, NestInterceptor, ExecutionContext, CallHandler, SetMetadata } from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { TenantContext } from '../tenant/tenant-context.js';

const CACHE_TTL_KEY = 'cache_ttl';
export const CacheTTL = (seconds: number) => SetMetadata(CACHE_TTL_KEY, seconds);

interface CacheEntry {
  data: any;
  expiry: number;
}

@Injectable()
export class MemoryCacheInterceptor implements NestInterceptor {
  private cache = new Map<string, CacheEntry>();

  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ttl = this.reflector.get<number>(CACHE_TTL_KEY, context.getHandler());
    if (!ttl) return next.handle();

    const request = context.switchToHttp().getRequest();
    // Scope the key by tenant: the same URL serves different data per org, so a
    // URL-only key would hand one organization's cached payload to another.
    const org = TenantContext.getOrganizationId() ?? 'global';
    const key = `${request.method}:${request.url}:${org}`;

    const cached = this.cache.get(key);
    if (cached && cached.expiry > Date.now()) {
      return of(cached.data);
    }

    return next.handle().pipe(
      tap(data => {
        this.cache.set(key, { data, expiry: Date.now() + ttl * 1000 });
        // Evict old entries periodically
        if (this.cache.size > 100) {
          const now = Date.now();
          for (const [k, v] of this.cache) {
            if (v.expiry < now) this.cache.delete(k);
          }
        }
      }),
    );
  }

  /** Called by events to invalidate dashboard cache */
  invalidate(pattern?: string): void {
    if (pattern) {
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) this.cache.delete(key);
      }
    } else {
      this.cache.clear();
    }
  }
}
