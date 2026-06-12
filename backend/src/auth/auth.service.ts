import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './entities/user.entity.js';
import { LoginDto } from './dto/login.dto.js';
import { RolePermissionsResolver } from '../rbac/role-permissions.resolver.js';

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

  /**
   * The CALLER's effective access: role + fine-grained permission keys
   * (may include the `*` wildcard for the system admin role).
   * This is what the web portal and mobile app gate their UI with.
   */
  async getMyAccess(principal: { id: string; roleId?: string | null; role?: string | null }) {
    const access = await this.permissionsResolver.resolveForUser(principal);
    return {
      role: {
        id: access.role.id,
        name: access.role.name,
        isSystem: access.role.isSystem,
      },
      permissions: [...access.permissions].sort(),
    };
  }
}
