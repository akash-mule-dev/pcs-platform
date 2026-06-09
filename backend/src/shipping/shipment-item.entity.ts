import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';
import { Shipment } from './shipment.entity.js';
import { AssemblyNode } from '../projects/assembly-node.entity.js';

/** One assembly (piece mark) loaded onto a shipment, with the shipped quantity. */
@Entity('shipment_items')
@Index(['organizationId', 'shipmentId'])
export class ShipmentItem extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'shipment_id', type: 'uuid' })
  shipmentId: string;

  @ManyToOne(() => Shipment, (s) => s.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shipment_id' })
  shipment: Shipment;

  @Column({ name: 'assembly_node_id', type: 'uuid' })
  assemblyNodeId: string;

  @ManyToOne(() => AssemblyNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assembly_node_id' })
  assemblyNode: AssemblyNode;

  @Column({ type: 'integer', default: 1 })
  quantity: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
