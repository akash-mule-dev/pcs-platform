import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContext } from './tenant-context.js';

/**
 * Populates the per-request TenantContext from the authenticated user.
 *
 * Registered globally (APP_INTERCEPTOR). Runs AFTER guards, so `req.user` is set
 * for JWT-protected routes; unauthenticated routes (login, health) simply carry a
 * null tenant. The JWT must include `organizationId` (see auth.service / jwt.strategy).
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest();
      const user = req?.user;
      TenantContext.set({
        organizationId: user?.organizationId ?? null,
        userId: user?.id ?? null,
      });
    }
    return next.handle();
  }
}
