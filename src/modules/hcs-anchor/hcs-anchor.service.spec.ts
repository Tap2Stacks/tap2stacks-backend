import { describe, expect, it, vi } from 'vitest';
import { HcsAnchorService } from './hcs-anchor.service';
import { MerkleTreeService } from './merkle-tree.service';
import { OrderStatus } from '../order/types';
import { Order } from '../order/entities/order.entity';
import { SettlementAnchorBatchStatus } from './types';

const buildSettledOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    orderId: 'user-a:cell-1',
    userId: 'user-a',
    marketId: 'btc',
    cellTimeStart: 1000,
    cellTimeEnd: 2000,
    lowerPrice: '95000',
    upperPrice: '96000',
    amount: '100',
    rewardRate: '1.9',
    placedAt: 900,
    status: OrderStatus.SETTLED,
    settledAt: 1500,
    settledWin: true,
    ...overrides,
  }) as Order;

describe('HcsAnchorService', () => {
  it('anchors pending settled orders through the mock publisher pipeline', async () => {
    const firstOrder = buildSettledOrder();
    const secondOrder = buildSettledOrder({
      orderId: 'user-b:cell-2',
      userId: 'user-b',
      settledAt: 1800,
      settledWin: false,
    });

    const orderRepository = {
      find: vi.fn().mockResolvedValue([firstOrder, secondOrder]),
    };
    const batchRepository = {
      create: vi.fn((value) => value),
      save: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const managerOrderRepository = {
      save: vi.fn().mockResolvedValue(undefined),
    };
    const managerBatchRepository = {
      update: vi.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: vi.fn(async (handler) =>
        handler({
          getRepository: vi.fn((entity) =>
            entity.name === 'Order'
              ? managerOrderRepository
              : managerBatchRepository,
          ),
        }),
      ),
    };
    const publisher = {
      submitAnchorMessage: vi.fn().mockResolvedValue({
        topicId: '0.0.mock',
        sequenceNumber: '123',
        consensusTimestamp: '2026-03-23T09:00:00.000Z',
        runningHash: '0xabc',
      }),
    };

    const service = new HcsAnchorService(
      orderRepository as any,
      batchRepository as any,
      dataSource as any,
      new MerkleTreeService(),
      publisher as any,
    );

    const result = await service.runOnce({ batchId: 'anchor_test_001' });

    expect(result.status).toBe('submitted');
    expect(result.anchoredCount).toBe(2);
    expect(batchRepository.save).toHaveBeenCalledTimes(1);
    expect(publisher.submitAnchorMessage).toHaveBeenCalledTimes(1);
    expect(managerBatchRepository.update).toHaveBeenCalledWith(
      { batchId: 'anchor_test_001' },
      expect.objectContaining({
        status: SettlementAnchorBatchStatus.SUBMITTED,
        topicId: '0.0.mock',
      }),
    );
    expect(managerOrderRepository.save).toHaveBeenCalledTimes(1);
    expect(firstOrder.anchorBatchId).toBe('anchor_test_001');
    expect(firstOrder.anchorLeafHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(firstOrder.anchoredAt).toBeTypeOf('number');
  });

  it('returns noop when there are no settled orders to anchor', async () => {
    const service = new HcsAnchorService(
      {
        find: vi.fn().mockResolvedValue([]),
      } as any,
      {
        create: vi.fn(),
        save: vi.fn(),
        update: vi.fn(),
      } as any,
      {
        transaction: vi.fn(),
      } as any,
      new MerkleTreeService(),
      {
        submitAnchorMessage: vi.fn(),
        verifyAnchorMessage: vi.fn(),
      } as any,
    );

    await expect(service.runOnce()).resolves.toEqual({
      status: 'noop',
      anchoredCount: 0,
    });
  });

  it('builds a verified Merkle proof for an anchored order', async () => {
    const anchorMerkleService = new MerkleTreeService();
    const anchoredOrders = [
      buildSettledOrder({
        orderId: 'user-a:cell-1',
        anchorBatchId: 'anchor_test_002',
      }),
      buildSettledOrder({
        orderId: 'user-b:cell-2',
        userId: 'user-b',
        settledAt: 1800,
        settledWin: false,
        anchorBatchId: 'anchor_test_002',
      }),
    ];
    const anchoredBatch = anchorMerkleService.prepareSettledOrders(anchoredOrders);
    const firstOrder = {
      ...anchoredOrders[0],
      amount: '999',
      anchorLeafHash: anchoredBatch.leaves[0].leafHash,
    };
    const secondOrder = {
      ...anchoredOrders[1],
      anchorLeafHash: anchoredBatch.leaves[1].leafHash,
    };

    const service = new HcsAnchorService(
      {
        find: vi.fn().mockResolvedValue([firstOrder, secondOrder]),
        findOneBy: vi.fn().mockResolvedValue(firstOrder),
      } as any,
      {
        findOneBy: vi.fn().mockResolvedValue({
          batchId: 'anchor_test_002',
          merkleRoot: anchoredBatch.merkleRoot,
          topicId: '0.0.mock',
          sequenceNumber: '456',
          consensusTimestamp: '2026-03-23T09:10:00.000Z',
        }),
        create: vi.fn(),
        save: vi.fn(),
        update: vi.fn(),
      } as any,
      {
        transaction: vi.fn(),
      } as any,
      new MerkleTreeService(),
      {
        submitAnchorMessage: vi.fn(),
        verifyAnchorMessage: vi.fn(),
      } as any,
    );

    const proof = await service.getOrderProof('user-a:cell-1');

    expect(proof.batchId).toBe('anchor_test_002');
    expect(proof.verified).toBe(true);
    expect(proof.leafHash).toBe(anchoredBatch.leaves[0].leafHash);
    expect(proof.proof.length).toBeGreaterThan(0);
  });

  it('verifies a submitted batch against the publisher', async () => {
    const service = new HcsAnchorService(
      {
        find: vi.fn(),
        findOneBy: vi.fn(),
      } as any,
      {
        findOneBy: vi.fn().mockResolvedValue({
          batchId: 'anchor_topic_001',
          topicId: '0.0.mock',
          sequenceNumber: '789',
          submittedPayload: '{"batchId":"anchor_topic_001"}',
        }),
      } as any,
      {
        transaction: vi.fn(),
      } as any,
      new MerkleTreeService(),
      {
        submitAnchorMessage: vi.fn(),
        verifyAnchorMessage: vi.fn().mockResolvedValue({
          found: true,
          topicId: '0.0.mock',
          sequenceNumber: '789',
          consensusTimestamp: '2026-03-23T09:30:00.000Z',
          runningHash: '0xdef',
          message: '{"batchId":"anchor_topic_001"}',
          payloadMatches: true,
        }),
      } as any,
    );

    await expect(service.verifyBatchTopic('anchor_topic_001')).resolves.toEqual({
      batchId: 'anchor_topic_001',
      topicId: '0.0.mock',
      sequenceNumber: '789',
      found: true,
      consensusTimestamp: '2026-03-23T09:30:00.000Z',
      runningHash: '0xdef',
      payloadMatches: true,
      message: '{"batchId":"anchor_topic_001"}',
    });
  });
});
