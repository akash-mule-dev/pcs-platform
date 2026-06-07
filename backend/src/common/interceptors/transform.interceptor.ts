import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ResponseFormat<T> {
  data: T;
  meta?: any;
}

/**
 * Keys that must never leave the API in a response body. Covers both the
 * camelCase entity property and the snake_case DB column form.
 */
const SENSITIVE_KEYS = new Set(['passwordHash', 'password_hash', 'password']);

/**
 * Recursively strips sensitive keys from a response payload, returning plain
 * JSON-safe objects.
 *
 * - Preserves `Date` and `Buffer` values untouched.
 * - Handles arrays and nested objects.
 * - Uses an ancestors-in-current-path set to break circular references WITHOUT
 *   dropping shared sibling references (TypeORM's identity map reuses the same
 *   related instance across many rows — those must be kept, only true cycles
 *   are collapsed).
 */
function sanitize(value: any, ancestors = new WeakSet<object>()): any {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return value;
  if (ancestors.has(value)) return undefined; // genuine cycle (ancestor on path)

  ancestors.add(value);
  let result: any;
  if (Array.isArray(value)) {
    result = value.map((item) => sanitize(item, ancestors));
  } else {
    result = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key)) continue;
      result[key] = sanitize(val, ancestors);
    }
  }
  ancestors.delete(value); // allow the same instance to appear again as a sibling
  return result;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ResponseFormat<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseFormat<T>> {
    return next.handle().pipe(
      map((result) => {
        if (result && result.data !== undefined && result.meta !== undefined) {
          return { data: sanitize(result.data), meta: result.meta };
        }
        return { data: sanitize(result) };
      }),
    );
  }
}
