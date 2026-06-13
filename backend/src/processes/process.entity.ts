import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
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

  /**
   * When this process was published into a tenant from the shared library, the
   * id of the originating library process. Lets re-publish update-in-place
   * (idempotent) and lets the UI badge it as "from library". NULL for processes
   * authored directly in the org (incl. the library's own master copies).
   */
  @Index()
  @Column({ name: 'library_origin_id', type: 'uuid', nullable: true })
  libraryOriginId: string | null;

  @OneToMany(() => Stage, (stage) => stage.process, { cascade: true })
  stages: Stage[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
