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
import { AssemblyNode } from './assembly-node.entity.js';
import { MaterialLot } from '../traceability/entities/material-lot.entity.js';

/**
 * Heat-number traceability: which material lot (heat # + mill cert) went into
 * which piece. Assigned at cutting, rolled up per shipment into the MTR
 * package — the compliance chain AISC/EN 1090 jobs require. Entity-only link
 * into the traceability module (no module dependency).
 */
@Entity('piece_lot_assignments')
@Index(['organizationId', 'projectId'])
@Index(['nodeId'])
@Index(['materialLotId'])
export class PieceLotAssignment extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'node_id', type: 'uuid' })
  nodeId: string;

  @ManyToOne(() => AssemblyNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'node_id' })
  node: AssemblyNode;

  @Column({ name: 'material_lot_id', type: 'uuid' })
  materialLotId: string;

  @ManyToOne(() => MaterialLot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'material_lot_id' })
  materialLot: MaterialLot;

  /** How many pieces/units of the node this lot covers (default: all). */
  @Column({ type: 'numeric', precision: 14, scale: 3, default: 1 })
  quantity: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true })
  createdByName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
