import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Role } from '../auth/entities/role.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { Product } from '../products/product.entity.js';
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
    @InjectRepository(Product) private productRepo: Repository<Product>,
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
    const existingRoles = await this.roleRepo.count();
    if (existingRoles > 0) {
      this.logger.log('Database already seeded, skipping');
      return;
    }

    this.logger.log('Seeding roles and default users...');
    const hash = await bcrypt.hash('123456', 10);

    // ─── ROLES ──────────────────────────────────────────────────────────
    const roles: Record<string, Role> = {};
    for (const r of ['admin', 'manager', 'supervisor', 'operator']) {
      roles[r] = await this.roleRepo.save(this.roleRepo.create({ name: r, description: `${r} role` }));
    }

    // ─── DEFAULT USERS (login accounts only) ────────────────────────────
    const usersData = [
      { employeeId: 'EMP-001', email: 'admin@pcs.com', firstName: 'Rajesh', lastName: 'Patil', role: 'admin' },
      { employeeId: 'EMP-002', email: 'manager@pcs.com', firstName: 'Priya', lastName: 'Sharma', role: 'manager' },
      { employeeId: 'EMP-003', email: 'supervisor1@pcs.com', firstName: 'Vikram', lastName: 'Deshmukh', role: 'supervisor' },
      { employeeId: 'EMP-004', email: 'supervisor2@pcs.com', firstName: 'Sneha', lastName: 'Kulkarni', role: 'supervisor' },
      { employeeId: 'EMP-005', email: 'operator1@pcs.com', firstName: 'Amit', lastName: 'Jadhav', role: 'operator', badgeId: 'B-001' },
      { employeeId: 'EMP-006', email: 'operator2@pcs.com', firstName: 'Pooja', lastName: 'Shinde', role: 'operator', badgeId: 'B-002' },
      { employeeId: 'EMP-007', email: 'operator3@pcs.com', firstName: 'Rahul', lastName: 'More', role: 'operator', badgeId: 'B-003' },
      { employeeId: 'EMP-008', email: 'operator4@pcs.com', firstName: 'Anita', lastName: 'Pawar', role: 'operator', badgeId: 'B-004' },
      { employeeId: 'EMP-009', email: 'operator5@pcs.com', firstName: 'Suresh', lastName: 'Kale', role: 'operator', badgeId: 'B-005' },
      { employeeId: 'EMP-010', email: 'operator6@pcs.com', firstName: 'Meena', lastName: 'Gaikwad', role: 'operator', badgeId: 'B-006' },
      { employeeId: 'EMP-011', email: 'operator7@pcs.com', firstName: 'Deepak', lastName: 'Bhosale', role: 'operator', badgeId: 'B-007' },
      { employeeId: 'EMP-012', email: 'operator8@pcs.com', firstName: 'Kavita', lastName: 'Mane', role: 'operator', badgeId: 'B-008' },
    ];

    for (const u of usersData) {
      await this.userRepo.save(this.userRepo.create({
        employeeId: u.employeeId,
        email: u.email,
        passwordHash: hash,
        firstName: u.firstName,
        lastName: u.lastName,
        badgeId: (u as any).badgeId || null,
        roleId: roles[u.role].id,
      }));
    }

    this.logger.log('Seeded: 4 roles, 12 users. All business data (products, processes, lines, work orders) must be created via the web portal or mobile app.');
  }

}
