import { Order } from '../order/entities/order.entity';

export enum SettlementAnchorBatchStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  FAILED = 'FAILED',
}

export type CanonicalSettledOrder = {
  schema: 'tap.settledOrder.v1';
  orderId: string;
  userId: string;
  marketId: string;
  amount: string;
  rewardRate: string;
  settledAt: number;
  settledWin: boolean;
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

export type SettlementAnchorBatchDraft = {
  batchId: string;
  orderCount: number;
  merkleRoot: string;
  windowStart: number | null;
  windowEnd: number | null;
  leaves: PreparedSettledOrderLeaf[];
};

export type SettledOrderAnchorPayload = {
  schema: 'tap.settledOrderAnchor.v1';
  batchId: string;
  recordType: 'settled_orders';
  hashAlg: 'sha256';
  merkleRoot: string;
  orderCount: number;
  windowStart: number | null;
  windowEnd: number | null;
  createdAt: string;
};

export type SubmitAnchorMessageInput = {
  batchId: string;
  payload: string;
};

export type SubmitAnchorMessageResult = {
  topicId: string;
  sequenceNumber: string;
  consensusTimestamp: string;
  runningHash: string;
};

export type VerifyAnchorMessageInput = {
  topicId: string;
  sequenceNumber: string;
  expectedPayload?: string;
};

export type VerifyAnchorMessageResult = {
  found: boolean;
  topicId: string;
  sequenceNumber: string;
  consensusTimestamp?: string;
  runningHash?: string;
  message?: string;
  payloadMatches?: boolean;
};

export type RunAnchorBatchOptions = {
  maxOrders?: number;
  batchId?: string;
};

export type RunAnchorBatchResult =
  | {
      status: 'noop';
      anchoredCount: 0;
    }
  | {
      status: 'submitted';
      batchId: string;
      anchoredCount: number;
      merkleRoot: string;
      payloadHash: string;
      topicId: string;
      sequenceNumber: string;
      consensusTimestamp: string;
      runningHash: string;
    };

export type AnchorBatchListResult = {
  items: {
    batchId: string;
    status: SettlementAnchorBatchStatus;
    orderCount: number;
    merkleRoot: string;
    topicId?: string;
    sequenceNumber?: string;
    consensusTimestamp?: string;
    createdAt: string;
    submittedAt?: string;
  }[];
};

export type OrderAnchorProofResult = {
  orderId: string;
  batchId: string;
  leafHash: string;
  merkleRoot: string;
  proof: MerkleProofStep[];
  verified: boolean;
  topicId?: string;
  sequenceNumber?: string;
  consensusTimestamp?: string;
};

export type BatchTopicVerificationResult = {
  batchId: string;
  topicId: string;
  sequenceNumber: string;
  found: boolean;
  consensusTimestamp?: string;
  runningHash?: string;
  payloadMatches?: boolean;
  message?: string;
};
