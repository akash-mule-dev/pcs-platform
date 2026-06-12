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
 * Fine-grained pipeline position (the coarse `status` enum stays untouched for
 * backward compatibility). Stage progression:
 *   uploaded → extracting → persisting → converting → completed | failed
 */
export type ImportFileStage =
  | 'uploaded' // source stored durably (storage + DB row)
  | 'extracting' // structure extraction (web-ifc) running
  | 'persisting' // assembly_nodes tree being upserted
  | 'converting' // GLB conversion job running
  | 'completed'
  | 'failed';

/** Overall pipeline % checkpoints per stage (conversion maps its own 0-100 into 55→99). */
export const IMPORT_STAGE_PROGRESS: Record<string, number> = {
  uploaded: 5,
  extracting: 10,
  persisting: 35,
  converting: 55,
  completed: 100,
};

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

  /** Fine-grained pipeline position; drives the monitoring UI stepper. */
  @Column({ type: 'varchar', length: 30, default: 'uploaded' })
  stage: string;

  /** Overall pipeline progress 0–100 (upload→extract→persist→convert→done). */
  @Column({ type: 'integer', default: 0 })
  progress: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'duration_ms', type: 'integer', nullable: true })
  durationMs: number | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  /** Denormalized for the history table (no join on every poll). */
  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true })
  createdByName: string | null;

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
