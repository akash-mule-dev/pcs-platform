import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './entities/user.entity.js';
import { LoginDto } from './dto/login.dto.js';
import { RolePermissionsResolver } from '../rbac/role-permissions.resolver.js';
import { expandGrants, PLATFORM_FEATURE_KEYS } from '../rbac/permission-catalog.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly permissionsResolver: RolePermissionsResolver,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({
      where: { email: dto.email },
      relations: ['role'],
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // Record the login for engagement analytics (best-effort — a write hiccup
    // must never block a valid sign-in). Support-impersonation sessions are
    // minted elsewhere and intentionally don't touch this.
    this.userRepo.update(user.id, { lastLoginAt: new Date() }).catch(() => {});
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role.name,
      roleId: user.roleId,
      employeeId: user.employeeId,
      organizationId: user.organizationId,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        mobileNo: user.mobileNo,
        firstName: user.firstName,
        lastName: user.lastName,
        employeeId: user.employeeId,
        organizationId: user.organizationId,
        role: {
          id: user.role.id,
          name: user.role.name,
          isSystem: user.role.isSystem,
          description: user.role.description,
        },
      },
    };
  }

  async getProfile(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['role'],
    });
    if (!user) throw new UnauthorizedException();
    const { passwordHash, ...result } = user as any;
    return result;
  }

  /** This user's guided-tour state: `{ [tourId]: version }` (empty when none). */
  async getTourState(userId: string): Promise<Record<string, string>> {
    const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'tourState'] });
    if (!user) throw new UnauthorizedException();
    return user.tourState ?? {};
  }

  /** Mark a tour completed/dismissed at the given version; returns the new map. */
  async markTourSeen(userId: string, tourId: string, version: string): Promise<Record<string, string>> {
    const state = await this.getTourState(userId);
    state[tourId] = version;
    await this.userRepo.update(userId, { tourState: state });
    return state;
  }

  /** Clear one tour's seen-flag (or all when no id) so auto-tours surface again. */
  async resetTours(userId: string, tourId?: string): Promise<Record<string, string>> {
    if (!tourId) {
      await this.userRepo.update(userId, { tourState: {} });
      return {};
    }
    const state = await this.getTourState(userId);
    delete state[tourId];
    await this.userRepo.update(userId, { tourState: state });
    return state;
  }

  /**
   * The CALLER's effective access: role + fine-grained permission keys.
   *
   * Wildcards are EXPANDED server-side into concrete catalog keys — the `*`
   * tenant wildcard excludes platform-scoped features (organizations), and
   * only this code knows that distinction. Clients (web sidebar/route guards,
   * mobile tabs) must never re-interpret wildcard semantics themselves;
   * shipping concrete keys makes their checks trivially correct.
   */
  async getMyAccess(principal: { id: string; roleId?: string | null; role?: string | null }) {
    const access = await this.permissionsResolver.resolveForUser(principal);
    return {
      role: {
        id: access.role.id,
        name: access.role.name,
        isSystem: access.role.isSystem,
      },
      permissions: expandGrants(access.permissions).sort(),
      // Which features are platform-scoped — lets clients partition their nav
      // (platform operators see only these; tenant users never do) without
      // re-deriving the catalog's `platform: true` flags themselves.
      platformFeatures: PLATFORM_FEATURE_KEYS,
    };
  }
}
