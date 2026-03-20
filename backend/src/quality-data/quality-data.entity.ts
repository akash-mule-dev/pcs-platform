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

@Entity('quality_data')
export class QualityData {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'model_id', type: 'uuid' })
  modelId: string;

  @ManyToOne(() => Model3D, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'model_id' })
  model: Model3D;

  @Column({ name: 'mesh_name', type: 'varchar', length: 255 })
  meshName: string;

  @Column({ name: 'region_label', type: 'varchar', length: 255, nullable: true })
  regionLabel: string;

  @Column({ type: 'varchar', length: 20 })
  status: string; // 'pass' | 'fail' | 'warning'

  @Column({ type: 'varchar', length: 100, nullable: true })
  inspector: string;

  @Column({ name: 'inspection_date', type: 'timestamp', nullable: true })
  inspectionDate: Date;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ name: 'defect_type', type: 'varchar', length: 100, nullable: true })
  defectType: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  severity: string; // 'low' | 'medium' | 'high' | 'critical'

  @Column({ name: 'measurement_value', type: 'decimal', precision: 10, scale: 4, nullable: true })
  measurementValue: number;

  @Column({ name: 'measurement_unit', type: 'varchar', length: 50, nullable: true })
  measurementUnit: string;

  @Column({ name: 'tolerance_min', type: 'decimal', precision: 10, scale: 4, nullable: true })
  toleranceMin: number;

  @Column({ name: 'tolerance_max', type: 'decimal', precision: 10, scale: 4, nullable: true })
  toleranceMax: number;

  // Phase 6: Sign-off workflow
  @Column({ name: 'signoff_status', type: 'varchar', length: 20, default: 'pending' })
  signoffStatus: string; // 'pending' | 'approved' | 'rejected'

  @Column({ name: 'signoff_by', type: 'varchar', length: 100, nullable: true })
  signoffBy: string | null;

  @Column({ name: 'signoff_date', type: 'timestamp', nullable: true })
  signoffDate: Date | null;

  @Column({ name: 'signoff_notes', type: 'text', nullable: true })
  signoffNotes: string | null;

  // Phase 6: Photo attachments (stored as JSON array of file paths)
  @Column({ name: 'attachments', type: 'jsonb', nullable: true })
  attachments: string[] | null;

  // Phase 12: Soft delete
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
