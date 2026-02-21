import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from '../auth/entities/role.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { Product } from '../products/product.entity.js';
import { Process } from '../processes/process.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { Line } from '../lines/line.entity.js';
import { Station } from '../stations/station.entity.js';
import { WorkOrder, WorkOrderStatus, WorkOrderPriority } from '../work-orders/work-order.entity.js';
import { WorkOrderStage, WorkOrderStageStatus } from '../work-orders/work-order-stage.entity.js';
import { TimeEntry, InputMethod } from '../time-tracking/time-entry.entity.js';

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
  ) {}

  async seed() {
    const existingRoles = await this.roleRepo.count();
    if (existingRoles > 0) {
      this.logger.log('Database already seeded, skipping');
      return;
    }

    this.logger.log('Seeding database...');
    const hash = await bcrypt.hash('password123', 10);

    // Roles
    const roles: Record<string, Role> = {};
    for (const r of ['admin', 'manager', 'supervisor', 'operator']) {
      roles[r] = await this.roleRepo.save(this.roleRepo.create({ name: r, description: `${r} role` }));
    }

    // Users
    const usersData = [
      { employeeId: 'EMP-001', email: 'admin@pcs.local', firstName: 'System', lastName: 'Admin', role: 'admin' },
      { employeeId: 'EMP-002', email: 'manager@pcs.local', firstName: 'Production', lastName: 'Manager', role: 'manager' },
      { employeeId: 'EMP-003', email: 'supervisor1@pcs.local', firstName: 'Line 1', lastName: 'Supervisor', role: 'supervisor' },
      { employeeId: 'EMP-004', email: 'supervisor2@pcs.local', firstName: 'Line 2', lastName: 'Supervisor', role: 'supervisor' },
      { employeeId: 'EMP-005', email: 'operator1@pcs.local', firstName: 'John', lastName: 'Smith', role: 'operator', badgeId: 'B-001' },
      { employeeId: 'EMP-006', email: 'operator2@pcs.local', firstName: 'Maria', lastName: 'Chen', role: 'operator', badgeId: 'B-002' },
      { employeeId: 'EMP-007', email: 'operator3@pcs.local', firstName: 'Ahmed', lastName: 'Kumar', role: 'operator', badgeId: 'B-003' },
      { employeeId: 'EMP-008', email: 'operator4@pcs.local', firstName: 'Lisa', lastName: 'Johnson', role: 'operator', badgeId: 'B-004' },
      { employeeId: 'EMP-009', email: 'operator5@pcs.local', firstName: 'Carlos', lastName: 'Rodriguez', role: 'operator', badgeId: 'B-005' },
    ];

    const users: Record<string, User> = {};
    for (const u of usersData) {
      users[u.email] = await this.userRepo.save(this.userRepo.create({
        employeeId: u.employeeId,
        email: u.email,
        passwordHash: hash,
        firstName: u.firstName,
        lastName: u.lastName,
        badgeId: (u as any).badgeId || null,
        roleId: roles[u.role].id,
      }));
    }

    // Products
    const products: Record<string, Product> = {};
    const productsData = [
      { name: 'Circuit Board Assembly', sku: 'PCB-X100', description: 'Standard PCB assembly unit' },
      { name: 'Electric Motor Unit', sku: 'MOT-200', description: 'Industrial electric motor' },
      { name: 'Temperature Sensor Module', sku: 'SEN-50', description: 'Precision temperature sensor' },
    ];
    for (const p of productsData) {
      products[p.sku] = await this.productRepo.save(this.productRepo.create(p));
    }

    // Processes & Stages
    const processesData: { name: string; sku: string; stages: { name: string; target: number }[] }[] = [
      {
        name: 'PCB Assembly', sku: 'PCB-X100',
        stages: [
          { name: 'Component Preparation', target: 600 },
          { name: 'SMT Placement', target: 900 },
          { name: 'Reflow Soldering', target: 1200 },
          { name: 'Inspection', target: 600 },
          { name: 'Through-Hole Assembly', target: 900 },
          { name: 'Wave Soldering', target: 800 },
          { name: 'Quality Control', target: 600 },
          { name: 'Packaging', target: 300 },
        ],
      },
      {
        name: 'Motor Assembly', sku: 'MOT-200',
        stages: [
          { name: 'Stator Winding', target: 1800 },
          { name: 'Rotor Assembly', target: 1200 },
          { name: 'Housing Preparation', target: 600 },
          { name: 'Final Assembly', target: 1500 },
          { name: 'Electrical Testing', target: 900 },
          { name: 'Quality Inspection', target: 600 },
          { name: 'Packaging', target: 300 },
        ],
      },
      {
        name: 'Sensor Module', sku: 'SEN-50',
        stages: [
          { name: 'PCB Prep', target: 300 },
          { name: 'Sensor Mounting', target: 600 },
          { name: 'Calibration', target: 900 },
          { name: 'Enclosure Assembly', target: 450 },
          { name: 'Final Test', target: 600 },
          { name: 'Packaging', target: 200 },
        ],
      },
    ];

    const processes: Record<string, Process> = {};
    const allStages: Record<string, Stage[]> = {};
    for (const pd of processesData) {
      const proc = await this.processRepo.save(this.processRepo.create({
        name: pd.name, version: 1, productId: products[pd.sku].id,
      }));
      processes[pd.name] = proc;
      allStages[pd.name] = [];
      for (let i = 0; i < pd.stages.length; i++) {
        const s = await this.stageRepo.save(this.stageRepo.create({
          processId: proc.id, name: pd.stages[i].name, sequence: i + 1, targetTimeSeconds: pd.stages[i].target,
        }));
        allStages[pd.name].push(s);
      }
    }

    // Lines & Stations
    const linesData = [
      { name: 'Line 1', description: 'PCB Assembly Line', stations: ['ST-1A', 'ST-1B', 'ST-1C', 'ST-1D', 'ST-1E', 'ST-1F'] },
      { name: 'Line 2', description: 'Motor Assembly Line', stations: ['ST-2A', 'ST-2B', 'ST-2C', 'ST-2D', 'ST-2E'] },
      { name: 'Line 3', description: 'Sensor Module Line', stations: ['ST-3A', 'ST-3B', 'ST-3C', 'ST-3D'] },
    ];

    const lines: Record<string, Line> = {};
    const stations: Record<string, Station> = {};
    for (const ld of linesData) {
      const line = await this.lineRepo.save(this.lineRepo.create({ name: ld.name, description: ld.description }));
      lines[ld.name] = line;
      for (const sn of ld.stations) {
        stations[sn] = await this.stationRepo.save(this.stationRepo.create({ name: sn, lineId: line.id }));
      }
    }

    // Work Orders
    const woData = [
      { num: 'WO-2026-0001', sku: 'PCB-X100', proc: 'PCB Assembly', line: 'Line 1', qty: 100, status: WorkOrderStatus.IN_PROGRESS, priority: WorkOrderPriority.HIGH },
      { num: 'WO-2026-0002', sku: 'MOT-200', proc: 'Motor Assembly', line: 'Line 2', qty: 50, status: WorkOrderStatus.PENDING, priority: WorkOrderPriority.MEDIUM },
      { num: 'WO-2026-0003', sku: 'SEN-50', proc: 'Sensor Module', line: 'Line 3', qty: 200, status: WorkOrderStatus.IN_PROGRESS, priority: WorkOrderPriority.URGENT },
      { num: 'WO-2026-0004', sku: 'PCB-X100', proc: 'PCB Assembly', line: null, qty: 75, status: WorkOrderStatus.DRAFT, priority: WorkOrderPriority.LOW },
      { num: 'WO-2026-0005', sku: 'MOT-200', proc: 'Motor Assembly', line: 'Line 2', qty: 30, status: WorkOrderStatus.COMPLETED, priority: WorkOrderPriority.MEDIUM },
    ];

    const workOrders: Record<string, WorkOrder> = {};
    for (const w of woData) {
      const wo = await this.woRepo.save(this.woRepo.create({
        orderNumber: w.num,
        productId: products[w.sku].id,
        processId: processes[w.proc].id,
        lineId: w.line ? lines[w.line].id : null,
        quantity: w.qty,
        status: w.status,
        priority: w.priority,
        startedAt: w.status === WorkOrderStatus.IN_PROGRESS || w.status === WorkOrderStatus.COMPLETED ? new Date('2026-02-18T08:00:00Z') : null,
        completedAt: w.status === WorkOrderStatus.COMPLETED ? new Date('2026-02-19T16:00:00Z') : null,
      }));
      workOrders[w.num] = wo;

      // Create work order stages
      const procStages = allStages[w.proc];
      for (const stage of procStages) {
        const woStageStatus = w.status === WorkOrderStatus.COMPLETED ? WorkOrderStageStatus.COMPLETED : WorkOrderStageStatus.PENDING;
        await this.wosRepo.save(this.wosRepo.create({
          workOrderId: wo.id,
          stageId: stage.id,
          status: woStageStatus,
        }));
      }
    }

    // Assign some operators to WO-2026-0001 and WO-2026-0003
    const wo1Stages = await this.wosRepo.find({ where: { workOrderId: workOrders['WO-2026-0001'].id }, relations: ['stage'] });
    const wo3Stages = await this.wosRepo.find({ where: { workOrderId: workOrders['WO-2026-0003'].id }, relations: ['stage'] });
    const operators = [users['operator1@pcs.local'], users['operator2@pcs.local'], users['operator3@pcs.local'], users['operator4@pcs.local'], users['operator5@pcs.local']];

    for (let i = 0; i < wo1Stages.length; i++) {
      wo1Stages[i].assignedUserId = operators[i % operators.length].id;
      wo1Stages[i].stationId = stations[`ST-1${String.fromCharCode(65 + (i % 6))}`].id;
      await this.wosRepo.save(wo1Stages[i]);
    }
    for (let i = 0; i < wo3Stages.length; i++) {
      wo3Stages[i].assignedUserId = operators[(i + 2) % operators.length].id;
      wo3Stages[i].stationId = stations[`ST-3${String.fromCharCode(65 + (i % 4))}`].id;
      await this.wosRepo.save(wo3Stages[i]);
    }

    // Seed ~50 time entries
    const now = new Date();
    const methods = [InputMethod.WEB, InputMethod.MOBILE, InputMethod.BADGE];
    let entryCount = 0;

    // Completed entries for WO-2026-0001
    for (let i = 0; i < wo1Stages.length && i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        const op = operators[(i + j) % operators.length];
        const stage = wo1Stages[i];
        const targetTime = stage.stage?.targetTimeSeconds || 600;
        const variance = (Math.random() * 0.4 - 0.2) * targetTime; // ±20%
        const duration = Math.round(targetTime + variance);
        const startTime = new Date(now.getTime() - (48 - entryCount) * 3600000);
        const endTime = new Date(startTime.getTime() + duration * 1000);

        await this.teRepo.save(this.teRepo.create({
          userId: op.id,
          workOrderStageId: stage.id,
          stationId: stage.stationId,
          startTime,
          endTime,
          durationSeconds: duration,
          inputMethod: methods[j % 3],
          notes: j === 0 ? 'Normal run' : null,
        }));
        entryCount++;
      }
    }

    // Completed entries for WO-2026-0003
    for (let i = 0; i < wo3Stages.length && i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        const op = operators[(i + j + 2) % operators.length];
        const stage = wo3Stages[i];
        const targetTime = stage.stage?.targetTimeSeconds || 500;
        const variance = (Math.random() * 0.4 - 0.2) * targetTime;
        const duration = Math.round(targetTime + variance);
        const startTime = new Date(now.getTime() - (24 - entryCount) * 3600000);
        const endTime = new Date(startTime.getTime() + duration * 1000);

        await this.teRepo.save(this.teRepo.create({
          userId: op.id,
          workOrderStageId: stage.id,
          stationId: stage.stationId,
          startTime,
          endTime,
          durationSeconds: duration,
          inputMethod: methods[j % 3],
        }));
        entryCount++;
      }
    }

    // Completed entries for WO-2026-0005
    const wo5Stages = await this.wosRepo.find({ where: { workOrderId: workOrders['WO-2026-0005'].id } });
    for (let i = 0; i < wo5Stages.length; i++) {
      const op = operators[i % operators.length];
      const startTime = new Date(now.getTime() - (72 + i * 2) * 3600000);
      const duration = 600 + Math.round(Math.random() * 300);
      const endTime = new Date(startTime.getTime() + duration * 1000);
      await this.teRepo.save(this.teRepo.create({
        userId: op.id,
        workOrderStageId: wo5Stages[i].id,
        startTime,
        endTime,
        durationSeconds: duration,
        inputMethod: InputMethod.WEB,
      }));
      entryCount++;

      wo5Stages[i].status = WorkOrderStageStatus.COMPLETED;
      wo5Stages[i].actualTimeSeconds = duration;
      wo5Stages[i].completedAt = endTime;
      wo5Stages[i].assignedUserId = op.id;
      await this.wosRepo.save(wo5Stages[i]);
    }

    // 3 active entries (no end_time) for live dashboard
    for (let i = 0; i < 3; i++) {
      const op = operators[i];
      const stage = i < 2 ? wo1Stages[6 + i] || wo1Stages[i] : wo3Stages[4] || wo3Stages[0];
      const startTime = new Date(now.getTime() - (15 + i * 10) * 60000); // 15-35 min ago

      await this.teRepo.save(this.teRepo.create({
        userId: op.id,
        workOrderStageId: stage.id,
        stationId: stage.stationId,
        startTime,
        endTime: null,
        inputMethod: methods[i],
      }));
      entryCount++;

      stage.status = WorkOrderStageStatus.IN_PROGRESS;
      stage.startedAt = startTime;
      stage.assignedUserId = op.id;
      await this.wosRepo.save(stage);
    }

    this.logger.log(`Seeded ${entryCount} time entries and all reference data`);
  }
}
