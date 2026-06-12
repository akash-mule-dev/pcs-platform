import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';

/**
 * Immutable audit trail of stage changes: WHO moved WHAT stage WHEN, from
 * where (web/mobile) and how (single tap vs bulk). Written by the production
 * order stage-update paths; never updated or deleted. Stage name is
 * denormalized so history survives process edits; the actor is stored by id
 * and resolved at read time.
 */
@Entity('work_order_stage_events')
@Index(['productionOrderId', 'createdAt'])
@Index(['assemblyNodeId', 'createdAt'])
export class StageEvent extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'work_order_stage_id', type: 'uuid' })
  workOrderStageId: string;

  @Column({ name: 'work_order_id', type: 'uuid' })
  workOrderId: string;

  @Column({ name: 'production_order_id', type: 'uuid', nullable: true })
  productionOrderId: string | null;

  @Column({ name: 'assembly_node_id', type: 'uuid', nullable: true })
  assemblyNodeId: string | null;

  @Column({ name: 'stage_name', type: 'varchar', length: 120, nullable: true })
  stageName: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  /** 'status' | 'qty' — prefixed with 'bulk_' when applied through the batch endpoint. */
  @Column({ type: 'varchar', length: 20 })
  action: string;

  @Column({ name: 'from_status', type: 'varchar', length: 20, nullable: true })
  fromStatus: string | null;

  @Column({ name: 'to_status', type: 'varchar', length: 20, nullable: true })
  toStatus: string | null;

  @Column({ name: 'from_qty', type: 'integer', nullable: true })
  fromQty: number | null;

  @Column({ name: 'to_qty', type: 'integer', nullable: true })
  toQty: number | null;

  /** Where the change came from: 'web' | 'mobile' | 'api'. */
  @Column({ type: 'varchar', length: 10, default: 'web' })
  source: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
