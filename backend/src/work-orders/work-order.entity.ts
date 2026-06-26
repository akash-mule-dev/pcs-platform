import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { Process } from '../processes/process.entity.js';
import { Line } from '../lines/line.entity.js';
import { AssemblyNode } from '../projects/assembly-node.entity.js';
import { WorkOrderStage } from './work-order-stage.entity.js';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';

export enum WorkOrderStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum WorkOrderPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

@Entity('work_orders')
export class WorkOrder extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_number', type: 'varchar', length: 50, unique: true })
  orderNumber: string;

  @Column({ name: 'process_id', type: 'uuid' })
  processId: string;

  @ManyToOne(() => Process, { eager: true })
  @JoinColumn({ name: 'process_id' })
  process: Process;

  @Column({ name: 'line_id', type: 'uuid', nullable: true })
  lineId: string | null;

  @ManyToOne(() => Line, { nullable: true, eager: true })
  @JoinColumn({ name: 'line_id' })
  line: Line | null;

  // Fabrication: a work order targets an assembly / subassembly node so the
  // existing stage engine drives each piece mark through its stages —
  // assemblies are the only fabrication target.
  @Column({ name: 'assembly_node_id', type: 'uuid', nullable: true })
  assemblyNodeId: string | null;

  @ManyToOne(() => AssemblyNode, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assembly_node_id' })
  assemblyNode: AssemblyNode | null;

  // Multi-order: the production order (customer/run) this per-assembly work order belongs to.
  @Column({ name: 'production_order_id', type: 'uuid', nullable: true })
  productionOrderId: string | null;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ name: 'completed_quantity', type: 'integer', default: 0 })
  completedQuantity: number;

  @Column({ type: 'enum', enum: WorkOrderStatus, default: WorkOrderStatus.DRAFT })
  status: WorkOrderStatus;

  @Column({ type: 'enum', enum: WorkOrderPriority, default: WorkOrderPriority.MEDIUM })
  priority: WorkOrderPriority;

  @Column({ name: 'due_date', type: 'timestamp', nullable: true })
  dueDate: Date | null;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  // Revision staleness: flagged (review-only, never blocks production) when a
  // re-import changed/removed the assembly this WO targets. "Needs review" when
  // revision_flagged_import_id IS NOT NULL AND revision_acked_at IS NULL.
  @Column({ name: 'revision_flagged_import_id', type: 'uuid', nullable: true })
  revisionFlaggedImportId: string | null;

  @Column({ name: 'revision_flagged_at', type: 'timestamptz', nullable: true })
  revisionFlaggedAt: Date | null;

  @Column({ name: 'revision_acked_at', type: 'timestamptz', nullable: true })
  revisionAckedAt: Date | null;

  @Column({ name: 'revision_acked_by_id', type: 'uuid', nullable: true })
  revisionAckedById: string | null;

  // Phase 7: Dependencies
  @Column({ name: 'depends_on_id', type: 'uuid', nullable: true })
  dependsOnId: string | null;

  @ManyToOne(() => WorkOrder, { nullable: true })
  @JoinColumn({ name: 'depends_on_id' })
  dependsOn: WorkOrder | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => WorkOrderStage, (wos) => wos.workOrder, { cascade: true })
  stages: WorkOrderStage[];
}
