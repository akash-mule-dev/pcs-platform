import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';

export enum AttendanceStatus { PRESENT = 'present', ABSENT = 'absent', LEAVE = 'leave', HOLIDAY = 'holiday' }

/** Daily attendance per employee (distinct from production time tracking). */
@Entity('attendance')
@Index(['organizationId', 'userId', 'date'], { unique: true })
export class Attendance extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ type: 'date' }) date: string; // YYYY-MM-DD
  @Column({ type: 'enum', enum: AttendanceStatus, default: AttendanceStatus.PRESENT }) status: AttendanceStatus;
  @Column({ name: 'clock_in_at', type: 'timestamp', nullable: true }) clockInAt: Date | null;
  @Column({ name: 'clock_out_at', type: 'timestamp', nullable: true }) clockOutAt: Date | null;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
