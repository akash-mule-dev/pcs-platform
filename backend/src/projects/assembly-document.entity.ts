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
import { AssemblyNode } from './assembly-node.entity.js';

/**
 * A document attached to an assembly node — shop drawings, weld maps, NC files —
 * or to the project itself (`node_id` null), e.g. package members that didn't
 * match a piece mark. The file lives in the StorageProvider (`assembly-docs/…`);
 * this row is the metadata + access path. `import_file_id` records which
 * uploaded package brought it in (the Monitoring "package contents" view).
 */
@Entity('assembly_documents')
@Index(['organizationId', 'projectId'])
@Index(['nodeId'])
@Index(['importFileId'])
export class AssemblyDocument extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'node_id', type: 'uuid', nullable: true })
  nodeId: string | null;

  @ManyToOne(() => AssemblyNode, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'node_id' })
  node: AssemblyNode | null;

  /** The import (package upload) this document was extracted from, if any. */
  @Column({ name: 'import_file_id', type: 'uuid', nullable: true })
  importFileId: string | null;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @Column({ name: 'content_type', type: 'varchar', length: 100 })
  contentType: string;

  @Column({ type: 'integer' })
  size: number;

  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey: string;

  /** Optional label ("Rev B shop drawing", "Weld map"). */
  @Column({ type: 'varchar', length: 200, nullable: true })
  label: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true })
  createdByName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
