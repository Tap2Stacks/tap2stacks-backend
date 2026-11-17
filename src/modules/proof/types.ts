import { Order } from '../order/entities/order.entity';

export enum SettlementAnchorBatchStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  FAILED = 'FAILED',
}

export type SettledTapStatus = 'WON' | 'LOST' | 'VOIDED';

export type CanonicalSettledOrder = {
  schema: 'tap2stacks.settledOrder.v1';
  orderId: string;
  userId: string;
  marketId: string;
  ticker: string;
  status: SettledTapStatus;
  amount: string;
  rewardRate: string;
  settledAt: number;
  settledWin: boolean | null;
  cellTimeStart: number;
  cellTimeEnd: number;
  lowerPrice: string;
  upperPrice: string;
};

export type PreparedSettledOrderLeaf = {
  order: Order;
  canonical: CanonicalSettledOrder;
  serialized: string;
  leafHash: string;
};

export type PreparedSettledOrderBatch = {
  orderCount: number;
  leaves: PreparedSettledOrderLeaf[];
  merkleRoot: string;
  windowStart: number | null;
  windowEnd: number | null;
};

export type MerkleProofStep = {
  position: 'left' | 'right';
  hash: string;
};

export type SettledOrderAnchorPayload = {
  schema: 'tap2stacks.settledOrderAnchor.v1';
  index: number;
  fromMs: number;
  toMs: number;
  tapsRoot: string;
  priceLogHash: string;
  txHash: string;
};

export type ProofPostResult = {
  txHash: string;
  index: number;
};

export type RunAnchorWindowResult =
  | {
      status: 'noop';
    }
  | {
      status: 'submitted';
      batchId: string;
      index: number;
      fromMs: number;
      toMs: number;
      orderCount: number;
      tapsRoot: string;
      priceLogHash: string;
      txHash: string;
    };

export type ProofBatchSummary = {
  index: number;
  fromMs: number;
  toMs: number;
  tapsRoot: string;
  priceLogHash: string;
  txHash: string;
};

export type ProofBatchTapItem = CanonicalSettledOrder & {
  leafHash: string;
  proof: MerkleProofStep[];
};

export type ProofBatchTapsResponse = {
  index: number;
  fromMs: number;
  toMs: number;
  tapsRoot: string;
  priceLogHash: string;
  txHash: string;
  taps: ProofBatchTapItem[];
};
