import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';
import { Project } from '../projects/project.entity.js';
import { ShipmentItem } from './shipment-item.entity.js';

export enum ShipmentStatus {
  PLANNED = 'planned',
  LOADED = 'loaded',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

/**
 * A shipping load for a project (truck / lift). Its items are the assemblies
 * being shipped; an assembly becomes eligible once its stages roll up to
 * READY_TO_SHIP. This is the "shipping list" the user maintains.
 */
@Entity('shipments')
@Index(['organizationId', 'projectId'])
export class Shipment extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ name: 'shipment_number', type: 'varchar', length: 50 })
  shipmentNumber: string;

  @Column({ type: 'enum', enum: ShipmentStatus, default: ShipmentStatus.PLANNED })
  status: ShipmentStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  destination: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  carrier: string | null;

  @Column({ name: 'planned_date', type: 'timestamp', nullable: true })
  plannedDate: Date | null;

  @Column({ name: 'shipped_at', type: 'timestamp', nullable: true })
  shippedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @OneToMany(() => ShipmentItem, (i) => i.shipment, { cascade: true })
  items: ShipmentItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
