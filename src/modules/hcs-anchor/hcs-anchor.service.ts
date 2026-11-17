import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Order } from '../order/entities/order.entity';
import { MerkleTreeService } from './merkle-tree.service';
import {
  AnchorBatchListResult,
  BatchTopicVerificationResult,
  OrderAnchorProofResult,
  RunAnchorBatchOptions,
  RunAnchorBatchResult,
  SettlementAnchorBatchDraft,
  SettlementAnchorBatchStatus,
  SettledOrderAnchorPayload,
} from './types';
import { Repository, DataSource, IsNull } from 'typeorm';
import { SettlementAnchorBatch } from './entities/settlement-anchor-batch.entity';
import { OrderStatus } from '../order/types';
import { HCS_PUBLISHER, HcsPublisher } from './publishers/hcs-publisher';

@Injectable()
export class HcsAnchorService {
  private readonly logger = new Logger(HcsAnchorService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(SettlementAnchorBatch)
    private readonly batchRepository: Repository<SettlementAnchorBatch>,
    private readonly dataSource: DataSource,
    private readonly merkleTreeService: MerkleTreeService,
    @Inject(HCS_PUBLISHER)
    private readonly publisher: HcsPublisher,
  ) {}

  prepareBatchDraft(
    orders: Order[],
    batchId: string = this.generateBatchId(),
  ): SettlementAnchorBatchDraft {
    const preparedBatch = this.merkleTreeService.prepareSettledOrders(orders);

    return {
      batchId,
      orderCount: preparedBatch.orderCount,
      merkleRoot: preparedBatch.merkleRoot,
      windowStart: preparedBatch.windowStart,
      windowEnd: preparedBatch.windowEnd,
      leaves: preparedBatch.leaves,
    };
  }

  generateBatchId(now: Date = new Date()): string {
    const isoCompact = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const suffix = now.getMilliseconds().toString().padStart(3, '0');
    return `anchor_${isoCompact}_${suffix}`;
  }

  async countPendingSettledOrders(): Promise<number> {
    return this.orderRepository.count({
      where: {
        status: OrderStatus.SETTLED,
        anchorBatchId: IsNull(),
      },
    });
  }

  async getBatches(limit: number = 20, offset: number = 0): Promise<AnchorBatchListResult> {
    const batches = await this.batchRepository.find({
      order: {
        createdAt: 'DESC',
      },
      take: limit,
      skip: offset,
    });

    return {
      items: batches.map((batch) => ({
        batchId: batch.batchId,
        status: batch.status,
        orderCount: batch.orderCount,
        merkleRoot: batch.merkleRoot,
        topicId: batch.topicId,
        sequenceNumber: batch.sequenceNumber,
        consensusTimestamp: batch.consensusTimestamp,
        createdAt: batch.createdAt.toISOString(),
        submittedAt: batch.submittedAt?.toISOString(),
      })),
    };
  }

  async getBatch(batchId: string): Promise<SettlementAnchorBatch> {
    const batch = await this.batchRepository.findOneBy({ batchId });
    if (!batch) {
      throw new NotFoundException(`Anchor batch ${batchId} not found`);
    }
    return batch;
  }

  async getOrderProof(orderId: string): Promise<OrderAnchorProofResult> {
    const order = await this.orderRepository.findOneBy({ orderId });

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    if (!order.anchorBatchId) {
      throw new NotFoundException(`Order ${orderId} has not been anchored`);
    }

    const batch = await this.getBatch(order.anchorBatchId);
    const ordersInBatch = await this.orderRepository.find({
      where: {
        anchorBatchId: order.anchorBatchId,
      },
      order: {
        settledAt: 'ASC',
        orderId: 'ASC',
      },
    });

    const preparedBatch = this.merkleTreeService.prepareSettledOrders(ordersInBatch);
    const recomputedLeafHashes = new Map(
      preparedBatch.leaves.map((leaf) => [leaf.order.orderId, leaf.leafHash]),
    );
    const leafIndex = ordersInBatch.findIndex(
      (batchOrder) => batchOrder.orderId === orderId,
    );

    if (leafIndex === -1) {
      throw new NotFoundException(
        `Order ${orderId} was not found inside anchor batch ${order.anchorBatchId}`,
      );
    }

    const leafHashes = ordersInBatch.map(
      (batchOrder) =>
        batchOrder.anchorLeafHash ??
        recomputedLeafHashes.get(batchOrder.orderId) ??
        this.merkleTreeService.hashSettledOrder(batchOrder),
    );
    const leafHash = leafHashes[leafIndex];
    const proof = this.merkleTreeService.buildMerkleProof(
      leafHashes,
      leafIndex,
    );
    const verified = this.merkleTreeService.verifyMerkleProof(
      leafHash,
      proof,
      batch.merkleRoot,
    );

    return {
      orderId,
      batchId: batch.batchId,
      leafHash,
      merkleRoot: batch.merkleRoot,
      proof,
      verified,
      topicId: batch.topicId,
      sequenceNumber: batch.sequenceNumber,
      consensusTimestamp: batch.consensusTimestamp,
    };
  }

  async verifyBatchTopic(
    batchId: string,
  ): Promise<BatchTopicVerificationResult> {
    const batch = await this.getBatch(batchId);

    if (!batch.topicId || !batch.sequenceNumber) {
      throw new NotFoundException(
        `Anchor batch ${batchId} does not have topic metadata yet`,
      );
    }

    const verification = await this.publisher.verifyAnchorMessage({
      topicId: batch.topicId,
      sequenceNumber: batch.sequenceNumber,
      expectedPayload: batch.submittedPayload,
    });

    return {
      batchId: batch.batchId,
      topicId: batch.topicId,
      sequenceNumber: batch.sequenceNumber,
      found: verification.found,
      consensusTimestamp: verification.consensusTimestamp,
      runningHash: verification.runningHash,
      payloadMatches: verification.payloadMatches,
      message: verification.message,
    };
  }

  async runOnce(
    options: RunAnchorBatchOptions = {},
  ): Promise<RunAnchorBatchResult> {
    const orders = await this.orderRepository.find({
      where: {
        status: OrderStatus.SETTLED,
        anchorBatchId: IsNull(),
      },
      order: {
        settledAt: 'ASC',
        orderId: 'ASC',
      },
      take: options.maxOrders,
    });

    if (orders.length === 0) {
      this.logger.log('No settled orders are pending anchoring');
      return {
        status: 'noop',
        anchoredCount: 0,
      };
    }

    const batchDraft = this.prepareBatchDraft(orders, options.batchId);
    const payload = this.buildAnchorPayload(batchDraft);
    const submittedPayload = JSON.stringify(payload);
    const payloadHash = this.merkleTreeService.sha256Hex(submittedPayload);

    await this.batchRepository.save(
      this.batchRepository.create({
        batchId: batchDraft.batchId,
        status: SettlementAnchorBatchStatus.PENDING,
        orderCount: batchDraft.orderCount,
        merkleRoot: batchDraft.merkleRoot,
        payloadHash,
        submittedPayload,
      }),
    );

    try {
      const submission = await this.publisher.submitAnchorMessage({
        batchId: batchDraft.batchId,
        payload: submittedPayload,
      });

      const anchoredAtMs = Date.now();

      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(SettlementAnchorBatch).update(
          { batchId: batchDraft.batchId },
          {
            status: SettlementAnchorBatchStatus.SUBMITTED,
            topicId: submission.topicId,
            sequenceNumber: submission.sequenceNumber,
            consensusTimestamp: submission.consensusTimestamp,
            runningHash: submission.runningHash,
            submittedAt: new Date(anchoredAtMs),
          },
        );

        const ordersToUpdate = batchDraft.leaves.map(({ order, leafHash }) => {
          order.anchorBatchId = batchDraft.batchId;
          order.anchorLeafHash = leafHash;
          order.anchoredAt = anchoredAtMs;
          return order;
        });

        await manager.getRepository(Order).save(ordersToUpdate);
      });

      this.logger.log(
        `Anchored ${batchDraft.orderCount} settled orders in batch ${batchDraft.batchId}`,
      );

      return {
        status: 'submitted',
        batchId: batchDraft.batchId,
        anchoredCount: batchDraft.orderCount,
        merkleRoot: batchDraft.merkleRoot,
        payloadHash,
        topicId: submission.topicId,
        sequenceNumber: submission.sequenceNumber,
        consensusTimestamp: submission.consensusTimestamp,
        runningHash: submission.runningHash,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown anchor failure';

      await this.batchRepository.update(
        { batchId: batchDraft.batchId },
        {
          status: SettlementAnchorBatchStatus.FAILED,
          errorMessage,
        },
      );

      throw error;
    }
  }

  private buildAnchorPayload(
    batchDraft: SettlementAnchorBatchDraft,
  ): SettledOrderAnchorPayload {
    return {
      schema: 'tap.settledOrderAnchor.v1',
      batchId: batchDraft.batchId,
      recordType: 'settled_orders',
      hashAlg: 'sha256',
      merkleRoot: batchDraft.merkleRoot,
      orderCount: batchDraft.orderCount,
      windowStart: batchDraft.windowStart,
      windowEnd: batchDraft.windowEnd,
      createdAt: new Date().toISOString(),
    };
  }
}
