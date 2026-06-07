import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';

export enum SerialStatus { IN_PRODUCTION = 'in_production', COMPLETED = 'completed', SHIPPED = 'shipped', SCRAPPED = 'scrapped' }

/** A serialized finished unit, linked to the work order that built it (per tenant). */
@Entity('serial_units')
@Index(['organizationId', 'serialNumber'], { unique: true })
@Index(['organizationId', 'workOrderId'])
export class SerialUnit extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'serial_number', type: 'varchar', length: 120 }) serialNumber: string;
  @Column({ name: 'product_id', type: 'uuid' }) productId: string;
  @Column({ name: 'work_order_id', type: 'uuid', nullable: true }) workOrderId: string | null;
  @Column({ type: 'enum', enum: SerialStatus, default: SerialStatus.IN_PRODUCTION }) status: SerialStatus;
  @Column({ name: 'produced_at', type: 'timestamp', nullable: true }) producedAt: Date | null;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
