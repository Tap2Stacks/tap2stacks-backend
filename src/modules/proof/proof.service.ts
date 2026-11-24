import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  resolveSettlementVoidGapMs,
  SETTLEMENT_VOID_GAP_MS_TOKEN,
} from 'src/config/settlement';
import { DataSource, Repository } from 'typeorm';
import { Order } from '../order/entities/order.entity';
import { OrderStatus } from '../order/types';
import { SettlementAnchorBatch } from './entities/settlement-anchor-batch.entity';
import { MerkleTreeService } from './merkle-tree.service';
import { PriceLogService } from './price-log.service';
import {
  PROOF_PUBLISHER,
  ProofPublisher,
} from './publishers/base-proof.publisher';
import {
  OrderProofLookupResponse,
  ProofBatchSummary,
  ProofBatchTapItem,
  ProofBatchTapsResponse,
  RunAnchorWindowResult,
  SettlementAnchorBatchStatus,
} from './types';

export const PROOF_WINDOW_MS = 300_000;

@Injectable()
export class ProofService {
  private readonly logger = new Logger(ProofService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(SettlementAnchorBatch)
    private readonly batchRepository: Repository<SettlementAnchorBatch>,
    private readonly dataSource: DataSource,
    private readonly merkleTreeService: MerkleTreeService,
    private readonly priceLogService: PriceLogService,
    @Inject(PROOF_PUBLISHER)
    private readonly publisher: ProofPublisher,
    @Optional()
    @Inject(SETTLEMENT_VOID_GAP_MS_TOKEN)
    private readonly settlementVoidGapMs?: number,
  ) {}

  private getSettlementVoidGapMs(): number {
    return this.settlementVoidGapMs ?? resolveSettlementVoidGapMs();
  }

  async runNextWindow(
    nowMs: number = Date.now(),
  ): Promise<RunAnchorWindowResult> {
    const window = await this.resolveNextWindow(nowMs);
    if (!window) {
      return { status: 'noop' };
    }

    const { fromMs, toMs, existingBatch } = window;
    const orders = await this.loadWindowOrders(fromMs, toMs);
    const prepared = this.merkleTreeService.prepareSettledOrders(orders);
    const { hash: priceLogHash } = await this.priceLogService.buildWithHash(
      fromMs,
      toMs,
    );
    const batchId = existingBatch?.batchId ?? `proof_${fromMs}_${toMs}`;
    const nextAttempt = (existingBatch?.attempts ?? 0) + 1;

    await this.markBatchPending(
      existingBatch,
      batchId,
      fromMs,
      toMs,
      prepared.orderCount,
      prepared.merkleRoot,
      priceLogHash,
    );

    try {
      const posted = await this.publisher.post(
        prepared.merkleRoot,
        priceLogHash,
        fromMs,
        toMs,
      );
      await this.markBatchSubmitted(
        batchId,
        posted.index,
        posted.txHash,
        nextAttempt,
        prepared.leaves,
      );

      this.logger.log(
        `Anchored proof index=${posted.index} range=[${fromMs},${toMs}) orders=${prepared.orderCount}`,
      );

      return {
        status: 'submitted',
        batchId,
        index: posted.index,
        fromMs,
        toMs,
        orderCount: prepared.orderCount,
        tapsRoot: prepared.merkleRoot,
        priceLogHash,
        txHash: posted.txHash,
      };
    } catch (error) {
      const lastError =
        error instanceof Error ? error.message : 'Unknown proof anchor failure';
      await this.batchRepository.update(
        { batchId },
        {
          status: SettlementAnchorBatchStatus.FAILED,
          attempts: nextAttempt,
          lastError,
        },
      );
      throw error;
    }
  }

  async listSubmittedBatches(
    limit: number = 20,
    offset: number = 0,
  ): Promise<ProofBatchSummary[]> {
    const batches = await this.batchRepository.find({
      where: { status: SettlementAnchorBatchStatus.SUBMITTED },
      order: { index: 'DESC' },
      take: Math.min(50, Math.max(1, limit)),
      skip: Math.max(0, offset),
    });

    return batches.map((batch) => this.toBatchSummary(batch));
  }

  async getBatchPriceLog(index: number): Promise<Buffer> {
    const batch = await this.findSubmittedBatchByIndex(index);
    return this.priceLogService.build(Number(batch.fromMs), Number(batch.toMs));
  }

  async getBatchTaps(index: number): Promise<ProofBatchTapsResponse> {
    const batch = await this.findSubmittedBatchByIndex(index);
    const taps = await this.buildBatchTapItems(batch.batchId);

    return {
      ...this.toBatchSummary(batch),
      taps,
    };
  }

  async getOrderProof(orderId: string): Promise<OrderProofLookupResponse> {
    const order = await this.orderRepository.findOneBy({ orderId });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} not found`,
      });
    }

    if (!order.anchorBatchId) {
      throw new NotFoundException({
        code: 'PROOF_PENDING',
        message: `Proof for order ${orderId} is pending`,
      });
    }

    const batch = await this.batchRepository.findOneBy({
      batchId: order.anchorBatchId,
    });
    if (
      !batch ||
      batch.status !== SettlementAnchorBatchStatus.SUBMITTED ||
      batch.index == null ||
      !batch.txHash
    ) {
      throw new NotFoundException({
        code: 'PROOF_PENDING',
        message: `Proof for order ${orderId} is pending`,
      });
    }

    const taps = await this.buildBatchTapItems(batch.batchId);
    const tap = taps.find((item) => item.orderId === order.orderId);
    if (!tap) {
      throw new NotFoundException({
        code: 'PROOF_PENDING',
        message: `Proof for order ${orderId} is pending`,
      });
    }

    const priceLogIndexes = await this.findCoveringPriceLogIndexes(
      Number(order.cellTimeStart) - this.getSettlementVoidGapMs(),
      Number(order.cellTimeEnd),
    );

    return {
      orderId: order.orderId,
      batch: this.toBatchSummary(batch),
      tap,
      priceLogIndexes,
    };
  }

  private toBatchSummary(batch: SettlementAnchorBatch): ProofBatchSummary {
    return {
      index: batch.index!,
      fromMs: Number(batch.fromMs),
      toMs: Number(batch.toMs),
      tapsRoot: batch.tapsRoot,
      priceLogHash: batch.priceLogHash,
      txHash: batch.txHash!,
    };
  }

  private async buildBatchTapItems(
    batchId: string,
  ): Promise<ProofBatchTapItem[]> {
    const orders = await this.orderRepository.find({
      where: { anchorBatchId: batchId },
      order: { settledAt: 'ASC', orderId: 'ASC' },
    });

    const prepared = this.merkleTreeService.prepareSettledOrders(orders);
    const leafHashes = prepared.leaves.map((leaf) => leaf.leafHash);

    return prepared.leaves.map((leaf, leafIndex) => ({
      ...leaf.canonical,
      leafHash: leaf.leafHash,
      proof: this.merkleTreeService.buildMerkleProof(leafHashes, leafIndex),
    }));
  }

  private async findCoveringPriceLogIndexes(
    coverStart: number,
    coverEnd: number,
  ): Promise<number[]> {
    const batches = await this.batchRepository
      .createQueryBuilder('batch')
      .where('batch.status = :status', {
        status: SettlementAnchorBatchStatus.SUBMITTED,
      })
      .andWhere('batch.fromMs <= :coverEnd', { coverEnd })
      .andWhere('batch.toMs > :coverStart', { coverStart })
      .orderBy('batch.index', 'ASC')
      .getMany();

    return batches.map((batch) => batch.index!);
  }

  private async resolveNextWindow(nowMs: number): Promise<{
    fromMs: number;
    toMs: number;
    existingBatch: SettlementAnchorBatch | null;
  } | null> {
    const unfinished = await this.batchRepository.findOne({
      where: [
        { status: SettlementAnchorBatchStatus.FAILED },
        { status: SettlementAnchorBatchStatus.PENDING },
      ],
      order: { fromMs: 'ASC' },
    });

    if (unfinished) {
      return {
        fromMs: Number(unfinished.fromMs),
        toMs: Number(unfinished.toMs),
        existingBatch: unfinished,
      };
    }

    const boundary = Math.floor(nowMs / PROOF_WINDOW_MS) * PROOF_WINDOW_MS;
    const latestSubmitted = await this.batchRepository.findOne({
      where: { status: SettlementAnchorBatchStatus.SUBMITTED },
      order: { toMs: 'DESC' },
    });

    const fromMs = latestSubmitted
      ? Number(latestSubmitted.toMs)
      : boundary - PROOF_WINDOW_MS;
    if (fromMs >= boundary) {
      return null;
    }

    return { fromMs, toMs: boundary, existingBatch: null };
  }

  private async loadWindowOrders(
    fromMs: number,
    toMs: number,
  ): Promise<Order[]> {
    return this.orderRepository
      .createQueryBuilder('order')
      .where('order.status IN (:...statuses)', {
        statuses: [OrderStatus.SETTLED, OrderStatus.VOIDED],
      })
      .andWhere('order.settledAt >= :fromMs', { fromMs })
      .andWhere('order.settledAt < :toMs', { toMs })
      .orderBy('order.settledAt', 'ASC')
      .addOrderBy('order.orderId', 'ASC')
      .getMany();
  }

  private async markBatchPending(
    existingBatch: SettlementAnchorBatch | null,
    batchId: string,
    fromMs: number,
    toMs: number,
    orderCount: number,
    tapsRoot: string,
    priceLogHash: string,
  ): Promise<void> {
    if (existingBatch) {
      await this.batchRepository.update(
        { batchId },
        {
          status: SettlementAnchorBatchStatus.PENDING,
          orderCount,
          tapsRoot,
          priceLogHash,
        },
      );
      return;
    }

    await this.batchRepository.save(
      this.batchRepository.create({
        batchId,
        index: null,
        fromMs,
        toMs,
        status: SettlementAnchorBatchStatus.PENDING,
        orderCount,
        tapsRoot,
        priceLogHash,
        txHash: null,
        attempts: 0,
        lastError: null,
        submittedAt: null,
      }),
    );
  }

  private async markBatchSubmitted(
    batchId: string,
    index: number,
    txHash: string,
    attempts: number,
    leaves: ReturnType<MerkleTreeService['prepareSettledOrders']>['leaves'],
  ): Promise<void> {
    const anchoredAtMs = Date.now();
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(SettlementAnchorBatch).update(
        { batchId },
        {
          status: SettlementAnchorBatchStatus.SUBMITTED,
          index,
          txHash,
          attempts,
          lastError: null,
          submittedAt: new Date(anchoredAtMs),
        },
      );

      if (leaves.length === 0) {
        return;
      }

      const ordersToUpdate = leaves.map(({ order, leafHash }) => {
        order.anchorBatchId = batchId;
        order.anchorLeafHash = leafHash;
        order.anchoredAt = anchoredAtMs;
        return order;
      });
      await manager.getRepository(Order).save(ordersToUpdate);
    });
  }

  private async findSubmittedBatchByIndex(
    index: number,
  ): Promise<SettlementAnchorBatch> {
    const batch = await this.batchRepository.findOne({
      where: {
        index,
        status: SettlementAnchorBatchStatus.SUBMITTED,
      },
    });
    if (!batch) {
      throw new NotFoundException(`Proof batch ${index} not found`);
    }
    return batch;
  }
}
