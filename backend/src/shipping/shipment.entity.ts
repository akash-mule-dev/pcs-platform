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
import { ProductionOrder } from '../projects/production-order.entity.js';
import { ShipmentItem } from './shipment-item.entity.js';

export enum ShipmentStatus {
  PLANNED = 'planned',
  LOADED = 'loaded',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

/**
 * A shipping load (truck / lift) for ONE production order (work order). Its items
 * are the assemblies that order has fabricated; an assembly becomes eligible once
 * THIS order's stages roll up to production-complete. Shipping belongs to the work
 * order — the project is a pure design container. `projectId` is retained
 * (derived from the order) only for the delivery-note header and the project-tree
 * heat rollup.
 */
@Entity('shipments')
@Index(['organizationId', 'productionOrderId'])
@Index(['organizationId', 'projectId'])
export class Shipment extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // The owning work order (production order). Nullable in the DB only so the
  // backfill migration can run; the service always stamps it on create.
  @Column({ name: 'production_order_id', type: 'uuid', nullable: true })
  productionOrderId: string | null;

  @ManyToOne(() => ProductionOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'production_order_id' })
  productionOrder: ProductionOrder;

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
