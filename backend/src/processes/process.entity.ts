import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Stage } from '../stages/stage.entity.js';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';

@Entity('processes')
export class Process extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @OneToMany(() => Stage, (stage) => stage.process, { cascade: true })
  stages: Stage[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
