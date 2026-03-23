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

    this.logger.log('Seeding database with demo data...');
    const hash = await bcrypt.hash('password123', 10);
    const now = new Date();

    // ─── ROLES ──────────────────────────────────────────────────────────
    const roles: Record<string, Role> = {};
    for (const r of ['admin', 'manager', 'supervisor', 'operator']) {
      roles[r] = await this.roleRepo.save(this.roleRepo.create({ name: r, description: `${r} role` }));
    }

    // ─── USERS ──────────────────────────────────────────────────────────
    const usersData = [
      { employeeId: 'EMP-001', email: 'admin@pcs.local', firstName: 'Rajesh', lastName: 'Patil', role: 'admin' },
      { employeeId: 'EMP-002', email: 'manager@pcs.local', firstName: 'Priya', lastName: 'Sharma', role: 'manager' },
      { employeeId: 'EMP-003', email: 'supervisor1@pcs.local', firstName: 'Vikram', lastName: 'Deshmukh', role: 'supervisor' },
      { employeeId: 'EMP-004', email: 'supervisor2@pcs.local', firstName: 'Sneha', lastName: 'Kulkarni', role: 'supervisor' },
      { employeeId: 'EMP-005', email: 'operator1@pcs.local', firstName: 'Amit', lastName: 'Jadhav', role: 'operator', badgeId: 'B-001' },
      { employeeId: 'EMP-006', email: 'operator2@pcs.local', firstName: 'Pooja', lastName: 'Shinde', role: 'operator', badgeId: 'B-002' },
      { employeeId: 'EMP-007', email: 'operator3@pcs.local', firstName: 'Rahul', lastName: 'More', role: 'operator', badgeId: 'B-003' },
      { employeeId: 'EMP-008', email: 'operator4@pcs.local', firstName: 'Anita', lastName: 'Pawar', role: 'operator', badgeId: 'B-004' },
      { employeeId: 'EMP-009', email: 'operator5@pcs.local', firstName: 'Suresh', lastName: 'Kale', role: 'operator', badgeId: 'B-005' },
      { employeeId: 'EMP-010', email: 'operator6@pcs.local', firstName: 'Meena', lastName: 'Gaikwad', role: 'operator', badgeId: 'B-006' },
      { employeeId: 'EMP-011', email: 'operator7@pcs.local', firstName: 'Deepak', lastName: 'Bhosale', role: 'operator', badgeId: 'B-007' },
      { employeeId: 'EMP-012', email: 'operator8@pcs.local', firstName: 'Kavita', lastName: 'Mane', role: 'operator', badgeId: 'B-008' },
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

    // ─── PRODUCTS ───────────────────────────────────────────────────────
    const products: Record<string, Product> = {};
    const productsData = [
      { name: 'Hydraulic Pump Assembly', sku: 'HPA-3200', description: 'High-pressure hydraulic pump for automotive braking systems' },
      { name: 'EV Motor Controller', sku: 'EMC-500', description: 'Brushless DC motor controller for electric vehicles' },
      { name: 'Precision Gear Box', sku: 'PGB-150', description: 'Multi-stage precision gearbox for CNC machines' },
      { name: 'Temperature Sensor Module', sku: 'TSM-80', description: 'Industrial-grade temperature sensor with digital output' },
      { name: 'LED Driver Circuit Board', sku: 'LDR-420', description: 'Constant-current LED driver PCB for industrial lighting' },
      { name: 'Pneumatic Valve Block', sku: 'PVB-600', description: '5/2 directional control pneumatic valve assembly' },
    ];
    for (const p of productsData) {
      products[p.sku] = await this.productRepo.save(this.productRepo.create(p));
    }

    // ─── PROCESSES & STAGES ─────────────────────────────────────────────
    const processesData = [
      {
        name: 'Hydraulic Pump Assembly', sku: 'HPA-3200',
        stages: [
          { name: 'Housing Machining', target: 1800 },
          { name: 'Piston Fitting', target: 1200 },
          { name: 'Seal Installation', target: 600 },
          { name: 'Valve Assembly', target: 900 },
          { name: 'Pressure Testing', target: 1500 },
          { name: 'Surface Treatment', target: 1200 },
          { name: 'Final Inspection', target: 600 },
          { name: 'Packaging & Labeling', target: 300 },
        ],
      },
      {
        name: 'EV Motor Controller Build', sku: 'EMC-500',
        stages: [
          { name: 'PCB Preparation', target: 600 },
          { name: 'SMT Component Placement', target: 900 },
          { name: 'Reflow Soldering', target: 1200 },
          { name: 'Power Module Assembly', target: 1500 },
          { name: 'Firmware Flashing', target: 300 },
          { name: 'Electrical Testing', target: 900 },
          { name: 'Thermal Cycling Test', target: 1800 },
          { name: 'Conformal Coating', target: 600 },
          { name: 'Quality Verification', target: 600 },
          { name: 'Packaging', target: 300 },
        ],
      },
      {
        name: 'Gearbox Assembly', sku: 'PGB-150',
        stages: [
          { name: 'Gear Cutting & Grinding', target: 2400 },
          { name: 'Shaft Preparation', target: 1200 },
          { name: 'Bearing Installation', target: 600 },
          { name: 'Gear Train Assembly', target: 1800 },
          { name: 'Lubrication & Sealing', target: 450 },
          { name: 'Run-in Testing', target: 1800 },
          { name: 'Noise & Vibration Check', target: 900 },
          { name: 'Final Inspection', target: 600 },
          { name: 'Packaging', target: 300 },
        ],
      },
      {
        name: 'Sensor Module Assembly', sku: 'TSM-80',
        stages: [
          { name: 'PCB Prep', target: 300 },
          { name: 'Sensor Element Mounting', target: 600 },
          { name: 'Wire Bonding', target: 450 },
          { name: 'Calibration', target: 900 },
          { name: 'Enclosure Assembly', target: 450 },
          { name: 'Final Test', target: 600 },
          { name: 'Packaging', target: 200 },
        ],
      },
      {
        name: 'LED Driver PCB Process', sku: 'LDR-420',
        stages: [
          { name: 'Solder Paste Application', target: 300 },
          { name: 'Component Placement', target: 600 },
          { name: 'Reflow Oven', target: 900 },
          { name: 'AOI Inspection', target: 300 },
          { name: 'Through-Hole Assembly', target: 600 },
          { name: 'Wave Soldering', target: 600 },
          { name: 'Burn-in Testing', target: 1200 },
          { name: 'Packaging', target: 200 },
        ],
      },
      {
        name: 'Pneumatic Valve Assembly', sku: 'PVB-600',
        stages: [
          { name: 'Body Machining QC', target: 600 },
          { name: 'Spool Fitting', target: 900 },
          { name: 'Spring & Seal Assembly', target: 600 },
          { name: 'Solenoid Mounting', target: 450 },
          { name: 'Leak Testing', target: 900 },
          { name: 'Function Verification', target: 600 },
          { name: 'Final QC & Packaging', target: 300 },
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

    // ─── LINES & STATIONS ───────────────────────────────────────────────
    const linesData = [
      { name: 'Line A — Hydraulics', description: 'Hydraulic pump and valve assembly', stations: ['A1-CNC', 'A2-FIT', 'A3-SEAL', 'A4-TEST', 'A5-COAT', 'A6-QC'] },
      { name: 'Line B — Electronics', description: 'PCB assembly and motor controllers', stations: ['B1-SMT', 'B2-REFLOW', 'B3-THT', 'B4-TEST', 'B5-COAT', 'B6-PACK'] },
      { name: 'Line C — Precision', description: 'Gearbox and precision components', stations: ['C1-GRIND', 'C2-TURN', 'C3-ASSEM', 'C4-TEST', 'C5-QC'] },
      { name: 'Line D — Sensors', description: 'Sensor and small module assembly', stations: ['D1-PREP', 'D2-MOUNT', 'D3-CAL', 'D4-TEST'] },
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

    // ─── WORK ORDERS ────────────────────────────────────────────────────
    const lineA = 'Line A — Hydraulics';
    const lineB = 'Line B — Electronics';
    const lineC = 'Line C — Precision';
    const lineD = 'Line D — Sensors';

    const woData = [
      // Active production — visible on Kanban and dashboard
      { num: 'WO-2026-0101', sku: 'HPA-3200', proc: 'Hydraulic Pump Assembly', line: lineA, qty: 120, status: WorkOrderStatus.IN_PROGRESS, priority: WorkOrderPriority.HIGH },
      { num: 'WO-2026-0102', sku: 'EMC-500', proc: 'EV Motor Controller Build', line: lineB, qty: 80, status: WorkOrderStatus.IN_PROGRESS, priority: WorkOrderPriority.URGENT },
      { num: 'WO-2026-0103', sku: 'PGB-150', proc: 'Gearbox Assembly', line: lineC, qty: 45, status: WorkOrderStatus.IN_PROGRESS, priority: WorkOrderPriority.HIGH },
      { num: 'WO-2026-0104', sku: 'TSM-80', proc: 'Sensor Module Assembly', line: lineD, qty: 500, status: WorkOrderStatus.IN_PROGRESS, priority: WorkOrderPriority.MEDIUM },
      { num: 'WO-2026-0105', sku: 'LDR-420', proc: 'LED Driver PCB Process', line: lineB, qty: 300, status: WorkOrderStatus.IN_PROGRESS, priority: WorkOrderPriority.MEDIUM },

      // Pending — queued up
      { num: 'WO-2026-0106', sku: 'PVB-600', proc: 'Pneumatic Valve Assembly', line: lineA, qty: 200, status: WorkOrderStatus.PENDING, priority: WorkOrderPriority.MEDIUM },
      { num: 'WO-2026-0107', sku: 'HPA-3200', proc: 'Hydraulic Pump Assembly', line: lineA, qty: 60, status: WorkOrderStatus.PENDING, priority: WorkOrderPriority.LOW },
      { num: 'WO-2026-0108', sku: 'EMC-500', proc: 'EV Motor Controller Build', line: lineB, qty: 150, status: WorkOrderStatus.PENDING, priority: WorkOrderPriority.HIGH },

      // Draft — planning stage
      { num: 'WO-2026-0109', sku: 'PGB-150', proc: 'Gearbox Assembly', line: null, qty: 30, status: WorkOrderStatus.DRAFT, priority: WorkOrderPriority.LOW },
      { num: 'WO-2026-0110', sku: 'TSM-80', proc: 'Sensor Module Assembly', line: null, qty: 1000, status: WorkOrderStatus.DRAFT, priority: WorkOrderPriority.MEDIUM },

      // Completed — for reporting
      { num: 'WO-2026-0051', sku: 'HPA-3200', proc: 'Hydraulic Pump Assembly', line: lineA, qty: 100, status: WorkOrderStatus.COMPLETED, priority: WorkOrderPriority.HIGH },
      { num: 'WO-2026-0052', sku: 'EMC-500', proc: 'EV Motor Controller Build', line: lineB, qty: 60, status: WorkOrderStatus.COMPLETED, priority: WorkOrderPriority.MEDIUM },
      { num: 'WO-2026-0053', sku: 'LDR-420', proc: 'LED Driver PCB Process', line: lineB, qty: 250, status: WorkOrderStatus.COMPLETED, priority: WorkOrderPriority.MEDIUM },
      { num: 'WO-2026-0054', sku: 'PVB-600', proc: 'Pneumatic Valve Assembly', line: lineA, qty: 150, status: WorkOrderStatus.COMPLETED, priority: WorkOrderPriority.LOW },
    ];

    const workOrders: Record<string, WorkOrder> = {};
    const operators = Object.values(users).filter(u => usersData.find(ud => ud.email === Object.keys(users).find(k => users[k].id === u.id))?.role === 'operator');
    const opList = [
      users['operator1@pcs.local'], users['operator2@pcs.local'], users['operator3@pcs.local'],
      users['operator4@pcs.local'], users['operator5@pcs.local'], users['operator6@pcs.local'],
      users['operator7@pcs.local'], users['operator8@pcs.local'],
    ];

    for (const w of woData) {
      const daysAgo = w.status === WorkOrderStatus.COMPLETED ? 14 : w.status === WorkOrderStatus.IN_PROGRESS ? 3 : 0;
      const wo = await this.woRepo.save(this.woRepo.create({
        orderNumber: w.num,
        productId: products[w.sku].id,
        processId: processes[w.proc].id,
        lineId: w.line ? lines[w.line].id : null,
        quantity: w.qty,
        status: w.status,
        priority: w.priority,
        startedAt: daysAgo > 0 ? new Date(now.getTime() - daysAgo * 86400000) : null,
        completedAt: w.status === WorkOrderStatus.COMPLETED ? new Date(now.getTime() - 7 * 86400000) : null,
      }));
      workOrders[w.num] = wo;

      // Create work order stages with realistic progression
      const procStages = allStages[w.proc];
      for (let i = 0; i < procStages.length; i++) {
        let stageStatus = WorkOrderStageStatus.PENDING;
        let completedAt: Date | null = null;
        let startedAt: Date | null = null;
        let actualTime: number | null = null;
        let assignedUserId: string | null = null;
        let stationId: string | null = null;

        if (w.status === WorkOrderStatus.COMPLETED) {
          stageStatus = WorkOrderStageStatus.COMPLETED;
          const target = procStages[i].targetTimeSeconds || 600;
          actualTime = Math.round(target * (0.85 + Math.random() * 0.3));
          startedAt = new Date(now.getTime() - (14 - i * 0.5) * 86400000);
          completedAt = new Date(startedAt.getTime() + actualTime * 1000);
          assignedUserId = opList[i % opList.length].id;
        } else if (w.status === WorkOrderStatus.IN_PROGRESS) {
          const completedCount = Math.floor(procStages.length * (0.3 + Math.random() * 0.4));
          if (i < completedCount) {
            stageStatus = WorkOrderStageStatus.COMPLETED;
            const target = procStages[i].targetTimeSeconds || 600;
            actualTime = Math.round(target * (0.85 + Math.random() * 0.3));
            startedAt = new Date(now.getTime() - (3 - i * 0.3) * 86400000);
            completedAt = new Date(startedAt.getTime() + actualTime * 1000);
            assignedUserId = opList[i % opList.length].id;
          } else if (i === completedCount) {
            stageStatus = WorkOrderStageStatus.IN_PROGRESS;
            startedAt = new Date(now.getTime() - (20 + Math.random() * 40) * 60000);
            assignedUserId = opList[i % opList.length].id;
          }
        }

        // Assign station from the work order's line
        if (w.line && assignedUserId) {
          const lineStations = linesData.find(l => l.name === w.line)?.stations || [];
          if (lineStations.length > 0) {
            stationId = stations[lineStations[i % lineStations.length]]?.id || null;
          }
        }

        await this.wosRepo.save(this.wosRepo.create({
          workOrderId: wo.id,
          stageId: procStages[i].id,
          status: stageStatus,
          startedAt,
          completedAt,
          actualTimeSeconds: actualTime,
          assignedUserId,
          stationId,
        }));
      }
    }

    // ─── TIME ENTRIES ───────────────────────────────────────────────────
    const methods = [InputMethod.WEB, InputMethod.MOBILE, InputMethod.BADGE];
    const notes = [
      'Standard run, no issues', 'Minor adjustment needed mid-cycle', null,
      'Material delay — 5 min wait', null, 'Rework on 2 units', null,
      'Smooth run', null, 'Tool change required', null, null,
    ];
    let entryCount = 0;

    // Generate time entries for all IN_PROGRESS and COMPLETED work orders
    for (const w of woData.filter(w => w.status === WorkOrderStatus.IN_PROGRESS || w.status === WorkOrderStatus.COMPLETED)) {
      const wo = workOrders[w.num];
      const woStages = await this.wosRepo.find({ where: { workOrderId: wo.id }, relations: ['stage'] });

      for (const woStage of woStages) {
        if (woStage.status === WorkOrderStageStatus.COMPLETED && woStage.assignedUserId) {
          // 2-3 completed time entries per completed stage (shift work)
          const shifts = 2 + Math.floor(Math.random() * 2);
          for (let s = 0; s < shifts; s++) {
            const target = woStage.stage?.targetTimeSeconds || 600;
            const duration = Math.round((target / shifts) * (0.8 + Math.random() * 0.4));
            const startTime = new Date((woStage.startedAt || now).getTime() + s * duration * 1000);
            const endTime = new Date(startTime.getTime() + duration * 1000);

            await this.teRepo.save(this.teRepo.create({
              userId: woStage.assignedUserId,
              workOrderStageId: woStage.id,
              stationId: woStage.stationId,
              startTime,
              endTime,
              durationSeconds: duration,
              inputMethod: methods[entryCount % 3],
              notes: notes[entryCount % notes.length],
            }));
            entryCount++;
          }
        } else if (woStage.status === WorkOrderStageStatus.IN_PROGRESS && woStage.assignedUserId) {
          // Active entry — no end time (shows as live on dashboard)
          await this.teRepo.save(this.teRepo.create({
            userId: woStage.assignedUserId,
            workOrderStageId: woStage.id,
            stationId: woStage.stationId,
            startTime: woStage.startedAt || new Date(now.getTime() - 20 * 60000),
            endTime: null,
            inputMethod: methods[entryCount % 3],
            notes: 'Currently working',
          }));
          entryCount++;
        }
      }
    }

    this.logger.log(`Seeded: 6 products, 6 processes, 4 lines, 21 stations, 14 work orders, ${entryCount} time entries`);
  }
}
