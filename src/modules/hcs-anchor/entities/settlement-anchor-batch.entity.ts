import { CreateDateColumn, Column, Entity, PrimaryColumn } from 'typeorm';
import { SettlementAnchorBatchStatus } from '../types';

@Entity('settlement_anchor_batches')
export class SettlementAnchorBatch {
  @PrimaryColumn()
  batchId: string;

  @Column({
    type: 'enum',
    enum: SettlementAnchorBatchStatus,
    default: SettlementAnchorBatchStatus.PENDING,
  })
  status: SettlementAnchorBatchStatus;

  @Column({ type: 'integer' })
  orderCount: number;

  @Column({ nullable: true })
  topicId?: string;

  @Column({ nullable: true })
  sequenceNumber?: string;

  @Column({ nullable: true })
  consensusTimestamp?: string;

  @Column({ nullable: true })
  runningHash?: string;

  @Column()
  merkleRoot: string;

  @Column()
  payloadHash: string;

  @Column({ type: 'text' })
  submittedPayload: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  submittedAt?: Date;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;
}
