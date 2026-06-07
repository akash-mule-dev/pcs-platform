import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';

/**
 * Per-tenant override of a role's access to a feature. Layered over the code
 * defaults in auth/permissions.config.ts so each customer can tailor RBAC
 * without code changes.
 */
@Entity('role_permissions')
@Index(['organizationId', 'role', 'feature'], { unique: true })
export class RolePermission extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 50 }) role: string;
  @Column({ type: 'varchar', length: 100 }) feature: string;
  @Column({ name: 'can_view', type: 'boolean', default: true }) canView: boolean;
  @Column({ name: 'can_manage', type: 'boolean', default: false }) canManage: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
