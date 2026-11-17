import { describe, expect, it, vi } from 'vitest';
import { PriceLogService } from './price-log.service';
import { recomputeStatus } from './verify-leaf';
import { CanonicalSettledOrder } from './types';

describe('PriceLogService', () => {
  it('price log bytes are deterministic and hash to a known sha256 for a fixed sample set', async () => {
    const samples = [
      { ticker: 'TSLA', tsMs: 1700000000150, price: '250.123456' },
      { ticker: 'NVDA', tsMs: 1700000000200, price: '157.55' },
      { ticker: 'NVDA', tsMs: 1700000000100, price: '157.5' },
    ];
    const queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue(samples),
    };
    const repo = {
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    const service = new PriceLogService(repo as any);
    const buffer = await service.build(1700000000000, 1700000300000);

    expect(buffer.toString('utf8')).toBe(
      '{"ticker":"NVDA","tsMs":1700000000100,"price":"157.500000"}\n' +
        '{"ticker":"NVDA","tsMs":1700000000200,"price":"157.550000"}\n' +
        '{"ticker":"TSLA","tsMs":1700000000150,"price":"250.123456"}\n',
    );
    expect(service.hashBuffer(buffer)).toBe(
      '0x01957a67b61b198a7549ce65f2f9047f0f956abbdfc00885b83bedebe08fd7a1',
    );
    expect(queryBuilder.where).toHaveBeenCalledWith('sample.tsMs >= :fromMs', {
      fromMs: 1700000000000,
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('sample.tsMs < :toMs', {
      toMs: 1700000300000,
    });
  });

  it('returns an empty buffer and empty-input sha256 for an empty range', async () => {
    const queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const service = new PriceLogService({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as any);

    const buffer = await service.build(1700000000000, 1700000300000);
    expect(buffer.length).toBe(0);
    expect(service.hashBuffer(buffer)).toBe(
      '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('recomputeStatus (verify-leaf)', () => {
  const priceLogLines = [
    '{"ticker":"NVDA","tsMs":1700000004500,"price":"157.000000"}',
    '{"ticker":"NVDA","tsMs":1700000006000,"price":"158.000000"}',
    '{"ticker":"NVDA","tsMs":1700000011000,"price":"158.500000"}',
    '{"ticker":"TSLA","tsMs":1700000006000,"price":"250.000000"}',
    '{"ticker":"TSLA","tsMs":1700000009000,"price":"251.000000"}',
  ];

  it('recomputes WON when price segment crosses the cell band during [cellTimeStart, cellTimeEnd)', () => {
    const wonLeaf: CanonicalSettledOrder = {
      schema: 'tap2stacks.settledOrder.v1',
      orderId: 'user-1:nvda:1',
      userId: '0x1111111111111111111111111111111111111111',
      marketId: 'NVDA',
      ticker: 'NVDA',
      status: 'WON',
      amount: '10',
      rewardRate: '1.9',
      settledAt: 1700000006000,
      settledWin: true,
      cellTimeStart: 1700000005000,
      cellTimeEnd: 1700000010000,
      lowerPrice: '157.40',
      upperPrice: '157.60',
    };

    expect(recomputeStatus(wonLeaf, priceLogLines)).toBe('WON');
  });

  it('recomputes LOST when no price segment in [cellTimeStart, cellTimeEnd) touches the cell band', () => {
    const lostLeaf: CanonicalSettledOrder = {
      schema: 'tap2stacks.settledOrder.v1',
      orderId: 'user-1:tsla:2',
      userId: '0x1111111111111111111111111111111111111111',
      marketId: 'TSLA',
      ticker: 'TSLA',
      status: 'LOST',
      amount: '10',
      rewardRate: '1.9',
      settledAt: 1700000012000,
      settledWin: false,
      cellTimeStart: 1700000005000,
      cellTimeEnd: 1700000010000,
      lowerPrice: '255.00',
      upperPrice: '256.00',
    };

    expect(recomputeStatus(lostLeaf, priceLogLines)).toBe('LOST');
  });
});
