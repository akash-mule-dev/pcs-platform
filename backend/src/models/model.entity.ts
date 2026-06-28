import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '../common/transformers/numeric.transformer.js';

@Entity('models')
export class Model3D {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @Column({ name: 'file_path', type: 'varchar', length: 500 })
  filePath: string;

  @Column({ name: 'file_size', type: 'int' })
  fileSize: number;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ name: 'file_format', type: 'varchar', length: 20, default: 'glb' })
  fileFormat: string;

  @Column({ name: 'model_type', type: 'varchar', length: 50, default: 'assembly' })
  modelType: string; // 'assembly' | 'quality'

  // metres-per-GLB-unit for a TRUE 1:1 AR render — carried from the source file's
  // declared unit at conversion (IFC IfcUnitAssignment / glTF metres / OCCT mm),
  // never guessed. null = unknown → the AR client falls back to its geometry/length
  // estimate. See conversion/meters-per-unit.ts.
  @Column({ name: 'meters_per_unit', type: 'numeric', precision: 12, scale: 6, nullable: true, transformer: numericTransformer })
  metersPerUnit: number | null;

  // Phase 9: Thumbnail for quick preview
  @Column({ name: 'thumbnail_path', type: 'varchar', length: 500, nullable: true })
  thumbnailPath: string | null;

  // Phase 9: Assembly instructions (JSON array of step objects)
  @Column({ name: 'assembly_instructions', type: 'jsonb', nullable: true })
  assemblyInstructions: { step: number; title: string; description: string; meshHighlight?: string }[] | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
