import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';

export enum EquipmentType {
  LASER = 'laser', PRESS_BRAKE = 'press_brake', CNC = 'cnc', WELDER = 'welder',
  SHEAR = 'shear', GRINDER = 'grinder', PAINT_BOOTH = 'paint_booth', OTHER = 'other',
}
export enum EquipmentStatus { RUNNING = 'running', IDLE = 'idle', DOWN = 'down', MAINTENANCE = 'maintenance' }

/** A machine / work-center asset (per tenant). */
@Entity('equipment')
@Index(['organizationId', 'code'], { unique: true })
export class Equipment extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 100 }) code: string;
  @Column({ type: 'varchar', length: 255 }) name: string;
  @Column({ type: 'enum', enum: EquipmentType, default: EquipmentType.OTHER }) type: EquipmentType;
  @Column({ name: 'line_id', type: 'uuid', nullable: true }) lineId: string | null;
  @Column({ name: 'station_id', type: 'uuid', nullable: true }) stationId: string | null;
  @Column({ type: 'enum', enum: EquipmentStatus, default: EquipmentStatus.IDLE }) status: EquipmentStatus;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
