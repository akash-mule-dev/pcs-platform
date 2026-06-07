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

/** On-hand inventory for a material at a location (per tenant). */
@Entity('material_stock')
@Index(['organizationId', 'materialId', 'location'], { unique: true })
export class MaterialStock extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @ManyToOne(() => Material, { eager: true })
  @JoinColumn({ name: 'material_id' })
  material: Material;

  @Column({ type: 'varchar', length: 100, default: 'MAIN' })
  location: string;

  @Column({ name: 'quantity_on_hand', type: 'numeric', precision: 14, scale: 3, default: 0, transformer: numericTransformer })
  quantityOnHand: number;

  @Column({ name: 'quantity_reserved', type: 'numeric', precision: 14, scale: 3, default: 0, transformer: numericTransformer })
  quantityReserved: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
