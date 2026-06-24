import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Role } from '../auth/entities/role.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { Organization } from '../organization/organization.entity.js';
import { Process } from '../processes/process.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { Line } from '../lines/line.entity.js';
import { Station } from '../stations/station.entity.js';
import { WorkOrder } from '../work-orders/work-order.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { TimeEntry } from '../time-tracking/time-entry.entity.js';
import { Model3D } from '../models/model.entity.js';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(Role) private roleRepo: Repository<Role>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Organization) private orgRepo: Repository<Organization>,
    @InjectRepository(Process) private processRepo: Repository<Process>,
    @InjectRepository(Stage) private stageRepo: Repository<Stage>,
    @InjectRepository(Line) private lineRepo: Repository<Line>,
    @InjectRepository(Station) private stationRepo: Repository<Station>,
    @InjectRepository(WorkOrder) private woRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStage) private wosRepo: Repository<WorkOrderStage>,
    @InjectRepository(TimeEntry) private teRepo: Repository<TimeEntry>,
    @InjectRepository(Model3D) private modelRepo: Repository<Model3D>,
  ) {}

  async seed() {
    // Users are the idempotency marker — system roles may already exist
    // (RbacSeedService syncs them on every boot, before --seed runs).
    const existingUsers = await this.userRepo.count();
    const defaultPassword = process.env.SEED_DEFAULT_PASSWORD || 'changeme-dev-only';
    if (!process.env.SEED_DEFAULT_PASSWORD) {
      this.logger.warn(
        'SEED_DEFAULT_PASSWORD not set — seeding users with an insecure default. ' +
          'Set SEED_DEFAULT_PASSWORD before using seeded accounts beyond local dev.',
      );
    }
    const hash = await bcrypt.hash(defaultPassword, 10);

    // ─── ROLES ──────────────────────────────────────────────────────────
    // Built-in system roles, upserted by name (RbacSeedService may have
    // created them already on bootstrap). Their fine-grained permissions live
    // in code (rbac/permission-catalog.ts); custom org roles are created at
    // runtime via the Roles & Permissions UI (POST /api/rbac/roles).
    const roles: Record<string, Role> = {};
    for (const r of ['admin', 'manager', 'supervisor', 'operator', 'platform-admin']) {
      const existing = await this.roleRepo.findOne({ where: { name: r, organizationId: IsNull() } });
      roles[r] = existing
        ?? await this.roleRepo.save(
          this.roleRepo.create({ name: r, description: `Built-in ${r} role`, isSystem: true, organizationId: null }),
        );
    }

    // Always ensure the requested platform operator exists, including on an
    // already-seeded database. Existing passwords are deliberately preserved.
    const platformEmail = 'platform@fabrixr.com';
    const existingPlatform = await this.userRepo.findOne({ where: { email: platformEmail } });
    if (existingPlatform) {
      existingPlatform.firstName = 'Platform';
      existingPlatform.lastName = 'Admin';
      existingPlatform.mobileNo = '9000000000';
      existingPlatform.roleId = roles['platform-admin'].id;
      existingPlatform.organizationId = null;
      existingPlatform.isActive = true;
      await this.userRepo.save(existingPlatform);
      this.logger.log(`Ensured platform admin ${platformEmail}`);
    } else {
      await this.userRepo.save(this.userRepo.create({
        employeeId: 'PLATFORM-ADMIN',
        email: platformEmail,
        mobileNo: '9000000000',
        passwordHash: hash,
        firstName: 'Platform',
        lastName: 'Admin',
        roleId: roles['platform-admin'].id,
        organizationId: null,
        isActive: true,
      }));
      this.logger.log(`Created platform admin ${platformEmail}`);
    }

    if (existingUsers > 0) {
      this.logger.log('Default users already seeded; platform admin sync completed');
      return;
    }

    this.logger.log('Seeding default users...');

    // ─── DEFAULT USERS (login accounts only) ────────────────────────────
    // EMP-000 is the org-less PLATFORM operator (provisions tenants); the
    // TenantBootstrapService deliberately never claims it for the default org.
    const usersData = [
      { employeeId: 'EMP-000', email: 'platform@pcs.com', mobileNo: '9876543000', firstName: 'Priya', lastName: 'Operator', role: 'platform-admin' },
      { employeeId: 'EMP-001', email: 'admin@pcs.com', mobileNo: '9876543001', firstName: 'Rajesh', lastName: 'Patil', role: 'admin' },
      { employeeId: 'EMP-002', email: 'manager@pcs.com', mobileNo: '9876543002', firstName: 'Priya', lastName: 'Sharma', role: 'manager' },
      { employeeId: 'EMP-003', email: 'supervisor1@pcs.com', mobileNo: '9876543003', firstName: 'Vikram', lastName: 'Deshmukh', role: 'supervisor' },
      { employeeId: 'EMP-004', email: 'supervisor2@pcs.com', mobileNo: '9876543004', firstName: 'Sneha', lastName: 'Kulkarni', role: 'supervisor' },
      { employeeId: 'EMP-005', email: 'operator1@pcs.com', mobileNo: '9876543005', firstName: 'Amit', lastName: 'Jadhav', role: 'operator' },
      { employeeId: 'EMP-006', email: 'operator2@pcs.com', mobileNo: '9876543006', firstName: 'Pooja', lastName: 'Shinde', role: 'operator' },
      { employeeId: 'EMP-007', email: 'operator3@pcs.com', mobileNo: '9876543007', firstName: 'Rahul', lastName: 'More', role: 'operator' },
      { employeeId: 'EMP-008', email: 'operator4@pcs.com', mobileNo: '9876543008', firstName: 'Anita', lastName: 'Pawar', role: 'operator' },
      { employeeId: 'EMP-009', email: 'operator5@pcs.com', mobileNo: '9876543009', firstName: 'Suresh', lastName: 'Kale', role: 'operator' },
      { employeeId: 'EMP-010', email: 'operator6@pcs.com', mobileNo: '9876543010', firstName: 'Meena', lastName: 'Gaikwad', role: 'operator' },
      { employeeId: 'EMP-011', email: 'operator7@pcs.com', mobileNo: '9876543011', firstName: 'Deepak', lastName: 'Bhosale', role: 'operator' },
      { employeeId: 'EMP-012', email: 'operator8@pcs.com', mobileNo: '9876543012', firstName: 'Kavita', lastName: 'Mane', role: 'operator' },
    ];

    // Tenant users belong to the default org (created by TenantBootstrapService,
    // which runs before --seed); stamping it here makes a FRESH database fully
    // usable after a single boot. The platform operator stays org-less by design.
    const defaultOrg = await this.orgRepo.findOne({ where: { slug: 'default' } });
    for (const u of usersData) {
      await this.userRepo.save(this.userRepo.create({
        employeeId: u.employeeId,
        email: u.email,
        mobileNo: u.mobileNo,
        passwordHash: hash,
        firstName: u.firstName,
        lastName: u.lastName,
        roleId: roles[u.role].id,
        organizationId: u.role === 'platform-admin' ? null : defaultOrg?.id ?? null,
      }));
    }

    this.logger.log('Seeded: 5 system roles, 14 users (including two org-less platform admins). All business data (processes, lines, work orders) must be created via the web portal or mobile app.');
  }

}
