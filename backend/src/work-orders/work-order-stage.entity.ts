import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { WorkOrder } from './work-order.entity.js';
import { Stage } from '../stages/stage.entity.js';
import { User } from '../auth/entities/user.entity.js';
import { Station } from '../stations/station.entity.js';

export enum WorkOrderStageStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  SKIPPED = 'skipped',
}

@Entity('work_order_stages')
export class WorkOrderStage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'work_order_id', type: 'uuid' })
  workOrderId: string;

  @ManyToOne(() => WorkOrder, (wo) => wo.stages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'work_order_id' })
  workOrder: WorkOrder;

  @Column({ name: 'stage_id', type: 'uuid' })
  stageId: string;

  @ManyToOne(() => Stage, { eager: true })
  @JoinColumn({ name: 'stage_id' })
  stage: Stage;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId: string | null;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'assigned_user_id' })
  assignedUser: User | null;

  @Column({ name: 'station_id', type: 'uuid', nullable: true })
  stationId: string | null;

  @ManyToOne(() => Station, { nullable: true, eager: true })
  @JoinColumn({ name: 'station_id' })
  station: Station | null;

  @Column({ type: 'enum', enum: WorkOrderStageStatus, default: WorkOrderStageStatus.PENDING })
  status: WorkOrderStageStatus;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'actual_time_seconds', type: 'integer', nullable: true })
  actualTimeSeconds: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
