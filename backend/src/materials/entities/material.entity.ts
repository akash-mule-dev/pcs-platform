import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';
import { numericTransformer } from '../../common/transformers/numeric.transformer.js';

export enum MaterialType {
  SHEET = 'sheet',
  PLATE = 'plate',
  BAR = 'bar',
  TUBE = 'tube',
  COIL = 'coil',
  FASTENER = 'fastener',
  CONSUMABLE = 'consumable',
  COMPONENT = 'component',
  OTHER = 'other',
}

/** Raw material / part master (per tenant). */
@Entity('materials')
@Index(['organizationId', 'code'], { unique: true })
export class Material extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  code: string; // SKU / part number, unique within a tenant

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'enum', enum: MaterialType, default: MaterialType.OTHER })
  type: MaterialType;

  @Column({ name: 'unit_of_measure', type: 'varchar', length: 20, default: 'ea' })
  unitOfMeasure: string; // kg, m, sheet, ea, …

  @Column({ type: 'text', nullable: true })
  specification: string | null; // grade/spec, e.g. "SS304 2mm"

  // ── BOM matching keys (fabrication) ──────────────────────────────────────
  // Assembly-tree parts carry (profile, material_grade); a material master with
  // the same normalized pair is the stock that satisfies those parts.
  @Column({ type: 'varchar', length: 120, nullable: true })
  profile: string | null; // section, e.g. "UC203x203x46", "PL10"

  @Column({ name: 'material_grade', type: 'varchar', length: 60, nullable: true })
  materialGrade: string | null; // e.g. "S355"

  /**
   * Valuation: MOVING-AVERAGE unit cost. Every receipt with a cost re-averages
   * it (see InventoryService.receive); issues/scrap consume at the current
   * average and stamp it onto the movement so historical cost never drifts.
   */
  @Column({ name: 'unit_cost', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  unitCost: number;

  @Column({ name: 'reorder_level', type: 'numeric', precision: 14, scale: 3, default: 0, transformer: numericTransformer })
  reorderLevel: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
