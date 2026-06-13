import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JWT_SECRET } from '../../common/constants/jwt.constant.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JWT_SECRET,
    });
  }

  async validate(payload: any) {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      // Fine-grained RBAC resolves permissions by role id; legacy tokens
      // (issued before this field existed) fall back to the role name.
      roleId: payload.roleId ?? null,
      employeeId: payload.employeeId,
      organizationId: payload.organizationId,
      // Support impersonation: when set, this principal is a platform operator
      // acting INSIDE a tenant. `impersonatedBy` keeps the real operator's id
      // for audit; clients show a banner. Normal sessions omit these.
      impersonation: payload.impersonation === true,
      impersonatedBy: payload.impersonatedBy ?? null,
    };
  }
}