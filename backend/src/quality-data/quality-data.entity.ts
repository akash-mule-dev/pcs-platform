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
import { Model3D } from '../models/model.entity.js';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';

@Entity('quality_data')
@Index(['organizationId', 'modelId'])
@Index(['organizationId', 'projectId'])
@Index(['organizationId', 'assemblyNodeId'])
@Index(['organizationId', 'signoffStatus', 'status'])
@Index('UQ_quality_data_org_client_key', ['organizationId', 'clientKey'], { unique: true })
export class QualityData extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Client-generated idempotency key: offline queues replay creates after
   * network drops; the unique (org, client_key) index turns a double-replay
   * into "return the already-saved row" instead of a duplicate record.
   */
  @Column({ name: 'client_key', type: 'uuid', nullable: true })
  clientKey: string | null;

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

  /** Authenticated user who recorded the inspection (stamped server-side, not spoofable). */
  @Column({ name: 'inspector_user_id', type: 'uuid', nullable: true })
  inspectorUserId: string | null;

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

  // Fabrication linkage — ties a quality record to the assembly node it was taken on.
  @Column({ name: 'assembly_node_id', type: 'uuid', nullable: true })
  assemblyNodeId: string | null;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  /**
   * The fabrication OPERATION this inspection was recorded at — the process
   * `stages.id` (and the specific `work_order_stages.id` instance). Lets a
   * per-stage hold point check for an acceptable inspection on its OWN stage,
   * and a re-inspection be tied to the operation that was reworked. Null for
   * inspections recorded without an operation context.
   */
  @Column({ name: 'stage_id', type: 'uuid', nullable: true })
  stageId: string | null;

  @Column({ name: 'work_order_stage_id', type: 'uuid', nullable: true })
  workOrderStageId: string | null;

  // Phase 6: Sign-off workflow
  @Column({ name: 'signoff_status', type: 'varchar', length: 20, default: 'pending' })
  signoffStatus: string; // 'pending' | 'approved' | 'rejected'

  @Column({ name: 'signoff_by', type: 'varchar', length: 100, nullable: true })
  signoffBy: string | null;

  /** Authenticated user who made the sign-off decision (stamped server-side). */
  @Column({ name: 'signoff_by_user_id', type: 'uuid', nullable: true })
  signoffByUserId: string | null;

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
