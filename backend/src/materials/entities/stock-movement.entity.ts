import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';
import { numericTransformer } from '../../common/transformers/numeric.transformer.js';
import { Material } from './material.entity.js';

export enum StockMovementType {
  RECEIPT = 'receipt',       // material received into stock
  ISSUE = 'issue',           // consumed by a work order
  SCRAP = 'scrap',           // scrapped / offcut loss
  ADJUSTMENT = 'adjustment', // manual stock correction
  RESERVE = 'reserve',       // reserved for a work order
  RELEASE = 'release',       // reservation released
  RETURN = 'return',         // issued material returned to stock (reverses an issue)
}

/** Immutable ledger of every stock movement (per tenant) — the audit trail. */
@Entity('stock_movements')
@Index(['organizationId', 'materialId'])
@Index(['organizationId', 'productionOrderId'])
@Index(['organizationId', 'workOrderId'])
export class StockMovement extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @ManyToOne(() => Material, { eager: true })
  @JoinColumn({ name: 'material_id' })
  material: Material;

  @Column({ type: 'enum', enum: StockMovementType })
  type: StockMovementType;

  @Column({ type: 'numeric', precision: 14, scale: 3, transformer: numericTransformer })
  quantity: number; // positive magnitude; the `type` defines its effect

  /**
   * Unit cost stamped AT MOVEMENT TIME (receipts: the purchase cost; issues/
   * scrap/returns: the moving average when they happened). Costing reads THIS,
   * never the material's current price — so past orders keep their true cost.
   */
  @Column({ name: 'unit_cost', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  unitCost: number | null;

  @Column({ type: 'varchar', length: 100, default: 'MAIN' })
  location: string;

  @Column({ name: 'work_order_id', type: 'uuid', nullable: true })
  workOrderId: string | null;

  /** Production order (customer/run) the material was consumed for — the costing + requirements link. */
  @Column({ name: 'production_order_id', type: 'uuid', nullable: true })
  productionOrderId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reference: string | null; // PO number, supplier, etc.

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
