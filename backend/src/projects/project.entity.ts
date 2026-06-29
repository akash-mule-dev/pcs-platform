import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';
import { AssemblyNode } from './assembly-node.entity.js';
import { ImportFile } from './import-file.entity.js';

/**
 * A fabrication project (job / contract). The top-level container a customer
 * creates and uploads an IFC/CAD file against. Its full structure lives in
 * `assembly_nodes` (one self-referencing tree); source files in `import_files`.
 * A pure design container: it carries no process — stage routing is chosen
 * per production order (and flows onto that order's work orders), since one
 * design can back many orders with different routings. Lifecycle status and
 * due dates also live on each production order, not here.
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

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Who created the project — stamped from the JWT at creation (the import row
   *  carries the same `created_by_*` pair). Nullable: legacy rows predate it. */
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 255, nullable: true })
  createdByName: string | null;

  /** Who last modified the project — stamped from the JWT on every update (and
   *  seeded to the creator at creation). Pairs with the auto `updated_at`. */
  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById: string | null;

  @Column({ name: 'updated_by_name', type: 'varchar', length: 255, nullable: true })
  updatedByName: string | null;

  @OneToMany(() => AssemblyNode, (n) => n.project)
  nodes: AssemblyNode[];

  @OneToMany(() => ImportFile, (f) => f.project)
  importFiles: ImportFile[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /**
   * Soft-delete marker. Set when the project is moved to the Trash; cleared on
   * restore. TypeORM auto-excludes rows with a non-null `deleted_at` from every
   * `find`/`findOne` (so deleted projects vanish from all the normal lists),
   * while remaining recoverable for a retention window before a scheduled purge
   * (`ProjectPurgeService`) permanently deletes the project and its whole subtree.
   */
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
