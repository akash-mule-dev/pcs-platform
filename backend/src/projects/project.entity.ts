import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { ImportFile } from './import-file.entity.js';
import { Process } from '../processes/process.entity.js';

/**
 * A fabrication project (job / contract). The top-level container a customer
 * creates and uploads an IFC/CAD file against. Its full structure lives in
 * `assembly_nodes` (one self-referencing tree); source files in `import_files`.
 * A pure design container: lifecycle status and due dates live on each
 * production order, not here.
 */
@Entity('projects')
@Index(['organizationId', 'projectNumber'])
export class Project extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'project_number', type: 'varchar', length: 100, nullable: true })
  projectNumber: string | null;

  @Column({ name: 'client_name', type: 'varchar', length: 255, nullable: true })
  clientName: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** The fabrication process (stage routing) attached to this project. */
  @Column({ name: 'process_id', type: 'uuid', nullable: true })
  processId: string | null;

  @ManyToOne(() => Process, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'process_id' })
  process: Process | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => AssemblyNode, (n) => n.project)
  nodes: AssemblyNode[];

  @OneToMany(() => ImportFile, (f) => f.project)
  importFiles: ImportFile[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
