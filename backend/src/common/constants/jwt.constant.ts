import { Logger } from '@nestjs/common';
import type { SignOptions } from 'jsonwebtoken';

const logger = new Logger('JwtConfig');

/**
 * Single source of truth for the JWT signing/verification secret.
 *
 * Both the JwtModule (signing) and JwtStrategy (verification) MUST use this
 * exact value. Previously each defined its own fallback ('dev-only-insecure-secret'
 * vs 'pcs-jwt-secret-key-2026'), which meant that whenever JWT_SECRET was unset
 * tokens were signed and verified with different keys and ALL authentication
 * silently failed. Centralizing here makes that class of bug impossible.
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }

  logger.warn('JWT_SECRET not set — using insecure development default. Set JWT_SECRET before deploying.');
  return 'dev-only-insecure-secret';
}

export const JWT_SECRET = resolveJwtSecret();
export const JWT_EXPIRES_IN: SignOptions['expiresIn'] =
  (process.env.JWT_EXPIRES_IN as SignOptions['expiresIn']) || '24h';
