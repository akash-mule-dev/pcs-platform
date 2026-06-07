import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';
import { numericTransformer } from '../../common/transformers/numeric.transformer.js';

/** A received batch of material with heat/cert traceability (per tenant). */
@Entity('material_lots')
@Index(['organizationId', 'materialId'])
@Index(['organizationId', 'lotNumber'])
export class MaterialLot extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'material_id', type: 'uuid' }) materialId: string;
  @Column({ name: 'lot_number', type: 'varchar', length: 100 }) lotNumber: string;
  @Column({ name: 'heat_number', type: 'varchar', length: 100, nullable: true }) heatNumber: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) supplier: string | null;
  @Column({ name: 'cert_reference', type: 'varchar', length: 255, nullable: true }) certReference: string | null; // mill cert / MTR
  @Column({ name: 'received_quantity', type: 'numeric', precision: 14, scale: 3, default: 0, transformer: numericTransformer }) receivedQuantity: number;
  @Column({ name: 'remaining_quantity', type: 'numeric', precision: 14, scale: 3, default: 0, transformer: numericTransformer }) remainingQuantity: number;
  @Column({ name: 'received_at', type: 'timestamp', nullable: true }) receivedAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
