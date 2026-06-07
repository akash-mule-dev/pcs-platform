import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';

/** A named work shift, e.g. "Day 06:00–14:00" (per tenant). */
@Entity('shifts')
export class Shift extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ name: 'start_time', type: 'varchar', length: 5 }) startTime: string; // HH:mm
  @Column({ name: 'end_time', type: 'varchar', length: 5 }) endTime: string;     // HH:mm
  @Column({ name: 'days_of_week', type: 'simple-array', nullable: true }) daysOfWeek: string[] | null; // ['1'..'7'] (Mon..Sun)
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
