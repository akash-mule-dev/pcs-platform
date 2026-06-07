import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type ConversionStatus =
  | 'pending'
  | 'converting'
  | 'optimizing'
  | 'uploading'
  | 'completed'
  | 'failed';

/**
 * Durable record of a single file-conversion job (any supported format -> GLB).
 * Survives restarts and drives both the status endpoint and the real-time UI.
 */
@Entity('conversion_jobs')
export class ConversionJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @Column({ name: 'source_format', type: 'varchar', length: 20 })
  sourceFormat: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: ConversionStatus;

  @Column({ type: 'int', default: 0 })
  progress: number;

  /** Storage key of the original uploaded file (handed off to the worker). */
  @Column({ name: 'source_key', type: 'varchar', length: 500, nullable: true })
  sourceKey: string | null;

  @Column({ name: 'source_size', type: 'int', nullable: true })
  sourceSize: number | null;

  /** sha256(file + options); lets an identical re-upload reuse the prior result. */
  @Index()
  @Column({ name: 'source_hash', type: 'varchar', length: 80, nullable: true })
  sourceHash: string | null;

  /** Storage key of the produced GLB (mirrors the created Model3D.fileName). */
  @Column({ name: 'output_key', type: 'varchar', length: 500, nullable: true })
  outputKey: string | null;

  @Column({ name: 'output_size', type: 'int', nullable: true })
  outputSize: number | null;

  @Column({ name: 'triangles_before', type: 'int', nullable: true })
  trianglesBefore: number | null;

  @Column({ name: 'triangles_after', type: 'int', nullable: true })
  trianglesAfter: number | null;

  /** The Model3D created on success. */
  @Column({ name: 'model_id', type: 'uuid', nullable: true })
  modelId: string | null;

  // ── Passthrough metadata used when creating the Model3D ──
  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'model_type', type: 'varchar', length: 50, default: 'assembly' })
  modelType: string;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  // ── Optimization options (snapshotted from the request) ──
  @Column({ type: 'jsonb', nullable: true })
  options: {
    optimize?: boolean;
    simplifyRatio?: number;
    draco?: boolean;
    quantize?: boolean;
    maxTexture?: number;
    sourceUnit?: string;
    upAxis?: string;
  } | null;

  /** Real-world bounding-box size of the produced GLB, in metres. */
  @Column({ type: 'jsonb', nullable: true })
  dimensions: { x: number; y: number; z: number } | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
