import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';
import { Skill } from './skill.entity.js';

/** A skill/certification held by an employee, with optional expiry (per tenant). */
@Entity('employee_skills')
@Index(['organizationId', 'userId', 'skillId'], { unique: true })
export class EmployeeSkill extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'skill_id', type: 'uuid' }) skillId: string;
  @ManyToOne(() => Skill, { eager: true }) @JoinColumn({ name: 'skill_id' }) skill: Skill;
  @Column({ type: 'varchar', length: 50, nullable: true }) level: string | null; // e.g. trainee / certified / expert
  @Column({ name: 'certified_at', type: 'timestamp', nullable: true }) certifiedAt: Date | null;
  @Column({ name: 'expires_at', type: 'timestamp', nullable: true }) expiresAt: Date | null;
  @Column({ name: 'certified_by', type: 'uuid', nullable: true }) certifiedBy: string | null;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
