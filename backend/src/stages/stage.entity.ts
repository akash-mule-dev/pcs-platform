import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Process } from '../processes/process.entity.js';

@Entity('stages')
@Unique(['processId', 'sequence'])
export class Stage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'process_id', type: 'uuid' })
  processId: string;

  @ManyToOne(() => Process, (p) => p.stages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'process_id' })
  process: Process;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'integer' })
  sequence: number;

  @Column({ name: 'target_time_seconds', type: 'integer' })
  targetTimeSeconds: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
