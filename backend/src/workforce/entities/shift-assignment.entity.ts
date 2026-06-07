import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity.js';
import { Shift } from './shift.entity.js';

/** Assignment of an employee to a shift over a date range (per tenant). */
@Entity('shift_assignments')
@Index(['organizationId', 'userId'])
export class ShiftAssignment extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'shift_id', type: 'uuid' }) shiftId: string;
  @ManyToOne(() => Shift, { eager: true }) @JoinColumn({ name: 'shift_id' }) shift: Shift;
  @Column({ name: 'effective_from', type: 'date' }) effectiveFrom: string;
  @Column({ name: 'effective_to', type: 'date', nullable: true }) effectiveTo: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
