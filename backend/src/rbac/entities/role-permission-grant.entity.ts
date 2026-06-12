import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Role } from '../../auth/entities/role.entity.js';

/**
 * One fine-grained permission (`<feature>.<action>`) granted to a custom role.
 * System roles have no grant rows — their permissions come from the code
 * catalog so they can never drift from the enforcing code.
 */
@Entity('role_permission_grants')
@Index('uq_role_permission_grant', ['roleId', 'permission'], { unique: true })
export class RolePermissionGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @ManyToOne(() => Role, (role) => role.grants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  /** A key from rbac/permission-catalog.ts, e.g. `work-orders.execute`. */
  @Column({ type: 'varchar', length: 100 })
  permission: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
