import { describe, expect, it, vi } from 'vitest';
import { Order } from '../order/entities/order.entity';
import { OrderStatus } from '../order/types';
import { MerkleTreeService } from './merkle-tree.service';
import { PriceLogService } from './price-log.service';
import { ProofService } from './proof.service';
import { SettlementAnchorBatchStatus } from './types';

const buildSettledOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    orderId: 'user-a:cell-1',
    userId: '0x1111111111111111111111111111111111111111',
    marketId: 'NVDA',
    ticker: 'NVDA',
    cellTimeStart: 1700000105000,
    cellTimeEnd: 1700000110000,
    lowerPrice: '157.40',
    upperPrice: '157.60',
    amount: '10',
    rewardRate: '1.9',
    placedAt: 1700000100000,
    status: OrderStatus.SETTLED,
    settledAt: 1700000106000,
    settledWin: true,
    ...overrides,
  }) as Order;

function makeOrderRepo(orders: Order[]) {
  const qb = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(orders),
  };
  return {
    createQueryBuilder: vi.fn().mockReturnValue(qb),
    find: vi.fn().mockResolvedValue(orders),
    qb,
  };
}

function makePriceLogRepo(samples: any[] = []) {
  const qb = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(samples),
  };
  return {
    createQueryBuilder: vi.fn().mockReturnValue(qb),
  };
}

describe('ProofService', () => {
  it('posts one contiguous batch per 5-minute boundary and records txHash and index', async () => {
    const boundary = 1700000400000;
    const orders = [
      buildSettledOrder(),
      buildSettledOrder({
        orderId: 'user-b:cell-2',
        status: OrderStatus.VOIDED,
        settledAt: 1700000120000,
        settledWin: undefined,
      }),
    ];
    const orderRepo = makeOrderRepo(orders);
    const batchRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((value) => ({ ...value })),
      save: vi.fn(async (value) => value),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const managerBatchRepo = { update: vi.fn().mockResolvedValue(undefined) };
    const managerOrderRepo = { save: vi.fn().mockResolvedValue(undefined) };
    const dataSource = {
      transaction: vi.fn(async (fn) =>
        fn({
          getRepository: (entity: any) =>
            entity.name === 'Order' ? managerOrderRepo : managerBatchRepo,
        }),
      ),
    };
    const publisher = {
      post: vi.fn().mockResolvedValue({ txHash: '0xtx_0', index: 0 }),
    };

    const service = new ProofService(
      orderRepo as any,
      batchRepo as any,
      dataSource as any,
      new MerkleTreeService(),
      new PriceLogService(makePriceLogRepo([]) as any),
      publisher as any,
    );

    const result = await service.runNextWindow(boundary + 5_000);

    expect(result).toMatchObject({
      status: 'submitted',
      index: 0,
      fromMs: boundary - 300_000,
      toMs: boundary,
      txHash: '0xtx_0',
    });
    expect(publisher.post).toHaveBeenCalledWith(
      expect.stringMatching(/^0x[0-9a-f]{64}$/),
      '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      boundary - 300_000,
      boundary,
    );
    expect(managerBatchRepo.update).toHaveBeenCalledWith(
      { batchId: expect.any(String) },
      expect.objectContaining({
        status: SettlementAnchorBatchStatus.SUBMITTED,
        index: 0,
        txHash: '0xtx_0',
      }),
    );
    expect(managerOrderRepo.save).toHaveBeenCalledTimes(1);
    expect(orders[1].anchorBatchId).toBeDefined();
  });

  it('retries a failed post on the next run without skipping the range', async () => {
    const fromMs = 1700000100000;
    const toMs = 1700000400000;
    const failedBatch = {
      batchId: 'proof_1700000100000_1700000400000',
      fromMs,
      toMs,
      tapsRoot: '0x' + '0'.repeat(64),
      priceLogHash: '0x' + '0'.repeat(64),
      status: SettlementAnchorBatchStatus.FAILED,
      orderCount: 0,
      attempts: 1,
      lastError: 'rpc timeout',
    };

    const orderRepo = makeOrderRepo([]);
    const batchRepo = {
      findOne: vi.fn().mockResolvedValueOnce(failedBatch),
      create: vi.fn((v) => ({ ...v })),
      save: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const managerBatchRepo = { update: vi.fn().mockResolvedValue(undefined) };
    const dataSource = {
      transaction: vi.fn(async (fn) =>
        fn({
          getRepository: () => managerBatchRepo,
        }),
      ),
    };
    const publisher = {
      post: vi.fn().mockResolvedValueOnce({ txHash: '0xretry_tx', index: 4 }),
    };

    const service = new ProofService(
      orderRepo as any,
      batchRepo as any,
      dataSource as any,
      new MerkleTreeService(),
      new PriceLogService(makePriceLogRepo([]) as any),
      publisher as any,
    );

    const laterNowMs = toMs + 600_000;
    const result = await service.runNextWindow(laterNowMs);

    expect(publisher.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      fromMs,
      toMs,
    );
    expect(result).toMatchObject({
      status: 'submitted',
      index: 4,
      fromMs,
      toMs,
      txHash: '0xretry_tx',
    });
    expect(managerBatchRepo.update).toHaveBeenCalledWith(
      { batchId: failedBatch.batchId },
      expect.objectContaining({
        status: SettlementAnchorBatchStatus.SUBMITTED,
        index: 4,
        txHash: '0xretry_tx',
        attempts: 2,
      }),
    );
  });

  it('covers a multi-window downtime gap in one contiguous batch [lastToMs, boundary)', async () => {
    const lastToMs = 1700000100000;
    const nowMs = lastToMs + 900_000 + 5_000;
    const expectedBoundary = lastToMs + 900_000;
    const batchRepo = {
      findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
        toMs: lastToMs,
        status: SettlementAnchorBatchStatus.SUBMITTED,
      }),
      create: vi.fn((v) => ({ ...v })),
      save: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const managerBatchRepo = { update: vi.fn().mockResolvedValue(undefined) };
    const publisher = {
      post: vi.fn().mockResolvedValueOnce({ txHash: '0xgap_tx', index: 1 }),
    };

    const service = new ProofService(
      makeOrderRepo([]) as any,
      batchRepo as any,
      {
        transaction: vi.fn(async (fn) =>
          fn({ getRepository: () => managerBatchRepo }),
        ),
      } as any,
      new MerkleTreeService(),
      new PriceLogService(makePriceLogRepo([]) as any),
      publisher as any,
    );

    const res = await service.runNextWindow(nowMs);
    expect(res).toMatchObject({
      status: 'submitted',
      index: 1,
      fromMs: lastToMs,
      toMs: expectedBoundary,
      txHash: '0xgap_tx',
    });
  });

  it('marks a failed post as FAILED with incremented attempts and lastError', async () => {
    const boundary = 1700000400000;
    const batchRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((v) => ({ ...v })),
      save: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const publisher = {
      post: vi.fn().mockRejectedValueOnce(new Error('nonce too low')),
    };

    const service = new ProofService(
      makeOrderRepo([]) as any,
      batchRepo as any,
      { transaction: vi.fn() } as any,
      new MerkleTreeService(),
      new PriceLogService(makePriceLogRepo([]) as any),
      publisher as any,
    );

    await expect(service.runNextWindow(boundary + 5_000)).rejects.toThrow(
      'nonce too low',
    );
    expect(batchRepo.update).toHaveBeenCalledWith(
      { batchId: expect.any(String) },
      expect.objectContaining({
        status: SettlementAnchorBatchStatus.FAILED,
        attempts: 1,
        lastError: 'nonce too low',
      }),
    );
  });
});
