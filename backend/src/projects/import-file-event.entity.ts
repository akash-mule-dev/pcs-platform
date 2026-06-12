import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';
import { ImportFile } from './import-file.entity.js';

/**
 * Append-only audit trail of an import's pipeline: one row per stage
 * transition, completion, failure or retry. Powers the per-import timeline in
 * the project monitoring tab (mirrors the ncr_events pattern). Progress *ticks*
 * are NOT recorded here (they go over the websocket + the import_files row) —
 * only meaningful transitions, so the table stays small.
 */
@Entity('import_file_events')
@Index(['organizationId', 'projectId'])
@Index(['importFileId'])
export class ImportFileEvent extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'import_file_id', type: 'uuid' })
  importFileId: string;

  @ManyToOne(() => ImportFile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'import_file_id' })
  importFile: ImportFile;

  /** Denormalized so project-level feeds don't need a join. */
  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  /** Pipeline stage at the time of the event (uploaded|extracting|persisting|converting|completed|failed). */
  @Column({ type: 'varchar', length: 30 })
  stage: string;

  /** Coarse ImportFileStatus snapshot. */
  @Column({ type: 'varchar', length: 20 })
  status: string;

  /** Overall pipeline % at the time of the event. */
  @Column({ type: 'integer', default: 0 })
  progress: number;

  /** Human-readable line for the timeline ("Structure extracted: 128 nodes"). */
  @Column({ type: 'varchar', length: 500 })
  message: string;

  /** Optional structured payload (node counts, job id, error class…). */
  @Column({ type: 'jsonb', nullable: true })
  detail: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
