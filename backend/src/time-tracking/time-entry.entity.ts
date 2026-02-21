import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../auth/entities/user.entity.js';
import { WorkOrderStage } from '../work-orders/work-order-stage.entity.js';
import { Station } from '../stations/station.entity.js';

export enum InputMethod {
  WEB = 'web',
  MOBILE = 'mobile',
  BADGE = 'badge',
  KIOSK = 'kiosk',
}

@Entity('time_entries')
export class TimeEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'work_order_stage_id', type: 'uuid' })
  workOrderStageId: string;

  @ManyToOne(() => WorkOrderStage, { eager: true })
  @JoinColumn({ name: 'work_order_stage_id' })
  workOrderStage: WorkOrderStage;

  @Column({ name: 'station_id', type: 'uuid', nullable: true })
  stationId: string | null;

  @ManyToOne(() => Station, { nullable: true, eager: true })
  @JoinColumn({ name: 'station_id' })
  station: Station | null;

  @Column({ name: 'start_time', type: 'timestamp' })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamp', nullable: true })
  endTime: Date | null;

  @Column({ name: 'duration_seconds', type: 'integer', nullable: true })
  durationSeconds: number | null;

  @Column({ name: 'break_seconds', type: 'integer', default: 0 })
  breakSeconds: number;

  @Column({ name: 'idle_seconds', type: 'integer', default: 0 })
  idleSeconds: number;

  @Column({ name: 'input_method', type: 'enum', enum: InputMethod, default: InputMethod.WEB })
  inputMethod: InputMethod;

  @Column({ name: 'is_rework', type: 'boolean', default: false })
  isRework: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
