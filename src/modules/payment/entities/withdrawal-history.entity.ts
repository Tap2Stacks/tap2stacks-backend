import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('withdrawal_history')
@Unique(['txHash', 'logIndex'])
export class WithdrawalHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  sessionId: string;

  @Column()
  userId: string;

  @Column('decimal', { precision: 30, scale: 6 })
  amount: string;

  @Column()
  txHash: string;

  @Column('int')
  logIndex: number;

  @CreateDateColumn()
  createdAt: Date;
}
