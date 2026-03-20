import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Model3D } from '../models/model.entity.js';

@Entity('drawings')
export class Drawing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'drawing_number', type: 'varchar', length: 100, nullable: true })
  drawingNumber: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  revision: string | null;

  @Column({ name: 'drawing_type', type: 'varchar', length: 50, default: 'detail' })
  drawingType: string; // 'detail' | 'erection' | 'general'

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @Column({ name: 'file_path', type: 'varchar', length: 500 })
  filePath: string;

  @Column({ name: 'file_size', type: 'int' })
  fileSize: number;

  @Column({ name: 'mime_type', type: 'varchar', length: 100, default: 'application/pdf' })
  mimeType: string;

  @Column({ name: 'model_id', type: 'uuid', nullable: true })
  modelId: string | null;

  @ManyToOne(() => Model3D, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'model_id' })
  model: Model3D;

  @Column({ name: 'package_name', type: 'varchar', length: 255, nullable: true })
  packageName: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
