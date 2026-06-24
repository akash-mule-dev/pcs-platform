import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany, Index } from 'typeorm';
import { Station } from '../stations/station.entity.js';
import { TenantOwnedEntity } from '../common/tenant/tenant-owned.entity.js';

@Entity('lines')
// Line names are unique PER ORGANIZATION (not globally — the old column-level
// `unique` caused a raw 500 when two tenants used the same line name). Named
// explicitly so the guarded migration and `synchronize` agree on the index.
@Index('UQ_lines_org_name', ['organizationId', 'name'], { unique: true })
export class Line extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Station, (s) => s.line, { cascade: true })
  stations: Station[];
}
