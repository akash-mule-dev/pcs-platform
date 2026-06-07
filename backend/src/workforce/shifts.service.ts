import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Shift } from './entities/shift.entity.js';
import { ShiftAssignment } from './entities/shift-assignment.entity.js';
import { Attendance } from './entities/attendance.entity.js';
import { TenantContext } from '../common/tenant/tenant-context.js';
import { CreateShiftDto, UpdateShiftDto, AssignShiftDto, RecordAttendanceDto } from './dto/workforce.dto.js';

@Injectable()
export class ShiftsService {
  constructor(
    @InjectRepository(Shift) private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(ShiftAssignment) private readonly saRepo: Repository<ShiftAssignment>,
    @InjectRepository(Attendance) private readonly attRepo: Repository<Attendance>,
  ) {}

  private get org(): string { return TenantContext.requireOrganizationId(); }

  // ---- Shifts ----
  listShifts(): Promise<Shift[]> { return this.shiftRepo.find({ where: { organizationId: this.org } as any }); }
  createShift(dto: CreateShiftDto): Promise<Shift> {
    return this.shiftRepo.save(this.shiftRepo.create({ ...(dto as any), organizationId: this.org }) as any);
  }
  async updateShift(id: string, dto: UpdateShiftDto): Promise<Shift> {
    const s = await this.shiftRepo.findOne({ where: { id, organizationId: this.org } as any });
    if (!s) throw new NotFoundException('Shift not found');
    Object.assign(s, dto);
    return this.shiftRepo.save(s);
  }
  async removeShift(id: string): Promise<void> {
    const s = await this.shiftRepo.findOne({ where: { id, organizationId: this.org } as any });
    if (!s) throw new NotFoundException('Shift not found');
    await this.shiftRepo.remove(s);
  }

  // ---- Shift assignments ----
  assignShift(dto: AssignShiftDto): Promise<ShiftAssignment> {
    return this.saRepo.save(this.saRepo.create({ ...(dto as any), organizationId: this.org }) as any);
  }
  listAssignments(userId?: string): Promise<ShiftAssignment[]> {
    const where: any = { organizationId: this.org };
    if (userId) where.userId = userId;
    return this.saRepo.find({ where, order: { effectiveFrom: 'DESC' } as any });
  }
  async removeAssignment(id: string): Promise<void> {
    const a = await this.saRepo.findOne({ where: { id, organizationId: this.org } as any });
    if (!a) throw new NotFoundException('Assignment not found');
    await this.saRepo.remove(a);
  }

  // ---- Attendance ----
  async recordAttendance(dto: RecordAttendanceDto): Promise<Attendance> {
    let row = await this.attRepo.findOne({ where: { userId: dto.userId, date: dto.date, organizationId: this.org } as any });
    if (row) {
      if (dto.status) row.status = dto.status;
      if (dto.note !== undefined) row.note = dto.note ?? null;
      return this.attRepo.save(row);
    }
    row = this.attRepo.create({ ...(dto as any), organizationId: this.org } as DeepPartial<Attendance>);
    return this.attRepo.save(row);
  }
  listAttendance(userId?: string, date?: string): Promise<Attendance[]> {
    const where: any = { organizationId: this.org };
    if (userId) where.userId = userId;
    if (date) where.date = date;
    return this.attRepo.find({ where, order: { date: 'DESC' } as any, take: 500 });
  }
}
