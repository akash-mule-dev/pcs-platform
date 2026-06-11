import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';
import { numericTransformer } from '../common/transformers/numeric.transformer.js';
import { Project } from './project.entity.js';
import { ImportFile } from './import-file.entity.js';
import { Model3D } from '../models/model.entity.js';

/**
 * Where a node sits in the fabrication hierarchy. Every supported source format
 * maps onto this single discriminator: IFC populates the full GROUP→ASSEMBLY→
 * SUBASSEMBLY→PART tree; geometry-only formats (OBJ/STL/…) land as a single PART.
 */
export enum AssemblyNodeType {
  GROUP = 'group', // spatial / organizational container (IFC storey, lot, phase)
  ASSEMBLY = 'assembly', // shippable assembly — top-level IfcElementAssembly
  SUBASSEMBLY = 'subassembly', // assembly nested inside another assembly
  PART = 'part', // single fabricated part: member, plate, fastener, accessory
}

/**
 * One node of a project's assembly tree — the single, self-referencing table
 * that absorbs assemblies, subassemblies and parts from ANY imported format.
 * `parent_id` builds the tree; `node_type` discriminates; promoted columns
 * (profile, grade, length, weight) stay queryable while the long tail of
 * IFC Psets/Qtos lives in `properties` (jsonb). `ifc_guid` is the stable key
 * that makes re-import idempotent and links the node to its GLB mesh.
 */
@Entity('assembly_nodes')
@Index(['organizationId', 'projectId'])
@Index(['organizationId', 'parentId'])
@Index(['organizationId', 'projectId', 'mark'])
@Index(['organizationId', 'projectId', 'ifcGuid'])
export class AssemblyNode extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, (p) => p.nodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => AssemblyNode, (n) => n.children, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent: AssemblyNode | null;

  @OneToMany(() => AssemblyNode, (n) => n.parent)
  children: AssemblyNode[];

  @Column({ name: 'node_type', type: 'enum', enum: AssemblyNodeType, default: AssemblyNodeType.PART })
  nodeType: AssemblyNodeType;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** Piece mark / assembly mark (e.g. "B-12", "b12-p1"). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  mark: string | null;

  @Column({ type: 'integer', default: 1 })
  quantity: number;

  // ── Provenance / source-file identity ──────────────────────────────────
  @Column({ name: 'ifc_guid', type: 'varchar', length: 64, nullable: true })
  ifcGuid: string | null;

  @Column({ name: 'ifc_class', type: 'varchar', length: 64, nullable: true })
  ifcClass: string | null;

  @Column({ name: 'source_format', type: 'varchar', length: 20, nullable: true })
  sourceFormat: string | null;

  @Column({ name: 'import_file_id', type: 'uuid', nullable: true })
  importFileId: string | null;

  @ManyToOne(() => ImportFile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'import_file_id' })
  importFile: ImportFile | null;

  // ── Promoted fabrication attributes (queryable); full bag in properties ──
  @Column({ type: 'varchar', length: 120, nullable: true })
  profile: string | null; // section, e.g. "UC203x203x46"

  @Column({ name: 'material_grade', type: 'varchar', length: 60, nullable: true })
  materialGrade: string | null; // e.g. "S355"

  @Column({ name: 'length_mm', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  lengthMm: number | null;

  @Column({ name: 'weight_kg', type: 'numeric', precision: 12, scale: 3, nullable: true, transformer: numericTransformer })
  weightKg: number | null;

  @Column({ type: 'jsonb', nullable: true })
  properties: Record<string, any> | null;

  // ── 3D viewer linkage ───────────────────────────────────────────────────
  @Column({ name: 'model_id', type: 'uuid', nullable: true })
  modelId: string | null;

  @ManyToOne(() => Model3D, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'model_id' })
  model: Model3D | null;

  /** Mesh/node name within the GLB (GUID-derived) used to highlight this part. */
  @Column({ name: 'mesh_name', type: 'varchar', length: 255, nullable: true })
  meshName: string | null;

  // ── Tree helpers (set by the importer; cheap ordering for rendering) ─────
  @Column({ type: 'integer', default: 0 })
  depth: number;

  @Column({ name: 'sort_index', type: 'integer', default: 0 })
  sortIndex: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
