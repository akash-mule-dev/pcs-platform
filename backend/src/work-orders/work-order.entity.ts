import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { Product } from '../products/product.entity.js';
import { Process } from '../processes/process.entity.js';
import { Line } from '../lines/line.entity.js';
import { WorkOrderStage } from './work-order-stage.entity.js';

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
export class WorkOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_number', type: 'varchar', length: 50, unique: true })
  orderNumber: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { eager: true })
  @JoinColumn({ name: 'product_id' })
  product: Product;

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => WorkOrderStage, (wos) => wos.workOrder, { cascade: true })
  stages: WorkOrderStage[];
}
