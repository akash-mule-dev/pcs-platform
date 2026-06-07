import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';

/** A skill or qualification type, e.g. "MIG welding", "CNC operation" (per tenant). */
@Entity('skills')
@Index(['organizationId', 'code'], { unique: true })
export class Skill extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 100 }) code: string;
  @Column({ type: 'varchar', length: 255 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
