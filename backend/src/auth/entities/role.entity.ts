import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { User } from './user.entity.js';
import { RolePermissionGrant } from '../../rbac/entities/role-permission-grant.entity.js';

/**
 * A role groups a set of fine-grained permissions (`<feature>.<action>`).
 *
 * Two kinds:
 *  - System roles (`isSystem = true`, `organizationId = NULL`): the built-in
 *    admin / manager / supervisor / operator. Immutable — their permissions
 *    come from the code catalog (rbac/permission-catalog.ts), shared by all
 *    tenants. Admins customize by duplicating into a custom role.
 *  - Custom roles (`organizationId` set): created by an organization's admin;
 *    their permissions live in `role_permission_grants`.
 *
 * Name is unique among system roles, and per-organization for custom roles.
 */
@Entity('roles')
@Index('uq_roles_system_name', ['name'], { unique: true, where: '"organization_id" IS NULL' })
@Index('uq_roles_org_name', ['organizationId', 'name'], { unique: true, where: '"organization_id" IS NOT NULL' })
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** NULL for built-in system roles; the owning tenant for custom roles. */
  @Index()
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  /** Built-in roles are immutable and cannot be deleted. */
  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => User, (user) => user.role)
  users: User[];

  @OneToMany(() => RolePermissionGrant, (grant) => grant.role)
  grants: RolePermissionGrant[];
}
