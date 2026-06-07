import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';

export enum TemplateType { NCR = 'ncr', INSPECTION = 'inspection', CHECKLIST = 'checklist', CAPA = 'capa', OTHER = 'other' }

/**
 * A per-tenant, drag-n-drop-configurable form/report template.
 * `schema` holds the Form.io (or JSON) form definition; data captured against a
 * template is stored on the owning record (e.g. NCR.dataJson), not here.
 */
@Entity('form_templates')
@Index(['organizationId', 'type'])
export class FormTemplate extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 255 }) name: string;
  @Column({ type: 'enum', enum: TemplateType, default: TemplateType.OTHER }) type: TemplateType;
  @Column({ type: 'jsonb', nullable: true }) schema: Record<string, any> | null;
  @Column({ type: 'integer', default: 1 }) version: number;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
