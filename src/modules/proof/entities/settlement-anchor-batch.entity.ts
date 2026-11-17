import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { BigIntMsTransformer } from 'src/libs/transformers';
import { SettlementAnchorBatchStatus } from '../types';

@Entity('settlement_anchor_batches')
export class SettlementAnchorBatch {
  @PrimaryColumn()
  batchId: string;

  @Column({ type: 'integer', nullable: true })
  index: number | null;

  @Column({
    type: 'bigint',
    transformer: BigIntMsTransformer,
  })
  fromMs: number;

  @Column({
    type: 'bigint',
    transformer: BigIntMsTransformer,
  })
  toMs: number;

  @Column({
    type: 'enum',
    enum: SettlementAnchorBatchStatus,
    default: SettlementAnchorBatchStatus.PENDING,
  })
  status: SettlementAnchorBatchStatus;

  @Column({ type: 'integer' })
  orderCount: number;

  @Column()
  tapsRoot: string;

  @Column()
  priceLogHash: string;

  @Column({ type: 'varchar', nullable: true })
  txHash: string | null;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  submittedAt: Date | null;
}
