import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Model3D } from '../models/model.entity.js';
import { Drawing } from './drawing.entity.js';

@Entity('coordination_packages')
export class CoordinationPackage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'project_name', type: 'varchar', length: 255, nullable: true })
  projectName: string | null;

  @Column({ name: 'model_id', type: 'uuid', nullable: true })
  modelId: string | null;

  @ManyToOne(() => Model3D, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'model_id' })
  model: Model3D;

  @OneToMany(() => Drawing, (d) => d.model)
  drawings: Drawing[];

  @Column({ name: 'kss_file_name', type: 'varchar', length: 255, nullable: true })
  kssFileName: string | null;

  @Column({ name: 'kss_data', type: 'jsonb', nullable: true })
  kssData: Record<string, unknown> | null;

  @Column({ name: 'source_file', type: 'varchar', length: 500, nullable: true })
  sourceFile: string | null;

  @Column({ name: 'detail_drawing_count', type: 'int', default: 0 })
  detailDrawingCount: number;

  @Column({ name: 'erection_drawing_count', type: 'int', default: 0 })
  erectionDrawingCount: number;

  @Column({ type: 'varchar', length: 50, default: 'processing' })
  status: string; // 'processing' | 'ready' | 'error'

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
