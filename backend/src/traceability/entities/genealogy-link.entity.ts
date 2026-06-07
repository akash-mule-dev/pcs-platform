import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';
import { numericTransformer } from '../../common/transformers/numeric.transformer.js';

/** Links a finished serial to a material lot it was built from — the genealogy. */
@Entity('genealogy_links')
@Index(['organizationId', 'serialId'])
@Index(['organizationId', 'materialLotId'])
export class GenealogyLink extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'serial_id', type: 'uuid' }) serialId: string;
  @Column({ name: 'material_lot_id', type: 'uuid' }) materialLotId: string;
  @Column({ type: 'numeric', precision: 14, scale: 3, default: 0, transformer: numericTransformer }) quantity: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
