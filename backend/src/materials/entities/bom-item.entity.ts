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
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';
import { numericTransformer } from '../../common/transformers/numeric.transformer.js';
import { Material } from './material.entity.js';

/**
 * Bill-of-materials line: one material required to build one unit of a product.
 * A product's full BOM is the set of its BomItems (per tenant).
 */
@Entity('bom_items')
@Index(['organizationId', 'productId', 'materialId'], { unique: true })
export class BomItem extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @ManyToOne(() => Material, { eager: true })
  @JoinColumn({ name: 'material_id' })
  material: Material;

  @Column({ name: 'quantity_per', type: 'numeric', precision: 14, scale: 4, transformer: numericTransformer })
  quantityPer: number; // material qty per 1 unit of the product

  @Column({ name: 'scrap_pct', type: 'numeric', precision: 6, scale: 3, default: 0, transformer: numericTransformer })
  scrapPct: number; // expected scrap %, e.g. 5 = 5% extra consumed

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
