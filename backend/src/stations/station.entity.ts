import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Line } from '../lines/line.entity.js';

@Entity('stations')
@Unique(['name', 'lineId'])
export class Station {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'line_id', type: 'uuid' })
  lineId: string;

  @ManyToOne(() => Line, (l) => l.stations)
  @JoinColumn({ name: 'line_id' })
  line: Line;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
