import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';
import { Project } from './project.entity.js';

export enum ImportFileStatus {
  UPLOADED = 'uploaded',
  CONVERTING = 'converting', // geometry → GLB (existing conversion pipeline)
  EXTRACTING = 'extracting', // structure → assembly_nodes (new extractor)
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * A source file uploaded to a project (IFC, STEP, mesh, …). Records provenance
 * and links the two pipeline outputs: the GLB (`model_id`, via conversion_jobs)
 * and the structured tree (the assembly_nodes whose `import_file_id` points here).
 */
@Entity('import_files')
@Index(['organizationId', 'projectId'])
export class ImportFile extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, (p) => p.importFiles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @Column({ type: 'varchar', length: 20 })
  format: string; // 'ifc' | 'step' | 'obj' | ...

  @Column({ name: 'storage_key', type: 'varchar', length: 500, nullable: true })
  storageKey: string | null;

  @Column({ type: 'integer', nullable: true })
  size: number | null;

  @Column({ type: 'enum', enum: ImportFileStatus, default: ImportFileStatus.UPLOADED })
  status: ImportFileStatus;

  /** Links to the existing conversion pipeline job that produced the GLB. */
  @Column({ name: 'conversion_job_id', type: 'uuid', nullable: true })
  conversionJobId: string | null;

  @Column({ name: 'model_id', type: 'uuid', nullable: true })
  modelId: string | null;

  @Column({ name: 'node_count', type: 'integer', default: 0 })
  nodeCount: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
