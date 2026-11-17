import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  process.env.POSTGRES_URL ??= 'postgres://postgres:postgres@localhost:5432/st_backend';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.ENGINE_URL ??= 'ws://localhost:8090';
  process.env.ENGINE_TOKEN ??= 'test-engine-token';
  process.env.RPC_URL ??= 'https://sepolia.base.org';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  process.env.ADMIN_API_KEY ??= 'test-admin-api-key-0123456789abcdef';
  process.env.CELL_SIGNER_KEY ??= 'test-cell-signer-key';
  process.env.WITHDRAW_SIGNER_PRIVATE_KEY ??= '0x1111111111111111111111111111111111111111111111111111111111111111';
  process.env.RELAYER_PRIVATE_KEY ??= '0x2222222222222222222222222222222222222222222222222222222222222222';
});

import { BadRequestException } from '@nestjs/common';
import { Cell, getCellId, signCell } from 'src/libs/cell';
import { FeedHealthStore } from '../engine/feed-health.store';
import { OrderService, OrderRejectedError } from './order.service';
import { ExposureTracker } from './exposure.tracker';
import { OrderStatus } from './types';

const SIGNER_KEY = 'test-cell-signer-key';

function makeSignedCell(
  overrides: Partial<Cell> = {},
  signerKey: string = SIGNER_KEY,
): Cell {
  const now = Date.now();
  const base: Omit<Cell, 'gridSignature'> = {
    ticker: 'NVDA',
    gridTs: now - 100,
    startTs: now + 10_000,
    endTs: now + 15_000,
    lowerPrice: '157.50',
    upperPrice: '157.53',
    rewardRate: '2.3100',
    ...overrides,
  };
  return {
    ...base,
    gridSignature: signCell(base, signerKey),
  };
}

describe('OrderService.placeOrder', () => {
  let feedHealthStore: FeedHealthStore;
  let exposureTracker: ExposureTracker;
  let orderRepository: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    findOneBy: ReturnType<typeof vi.fn>;
  };
  let accountService: {
    placeBet: ReturnType<typeof vi.fn>;
    settleBet: ReturnType<typeof vi.fn>;
    voidBet: ReturnType<typeof vi.fn>;
  };
  let events: {
    emitOrderUpdate: ReturnType<typeof vi.fn>;
  };
  let engineClient: {
    sendExposure: ReturnType<typeof vi.fn>;
  };
  let service: OrderService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1795000000000));

    feedHealthStore = new FeedHealthStore();
    feedHealthStore.markConnected(Date.now());
    feedHealthStore.updateHealth({
      type: 'health',
      ticker: 'NVDA',
      serverTsMs: Date.now(),
      lastSampleAgeMs: 100,
      stale: false,
    });
    feedHealthStore.updateHealth({
      type: 'health',
      ticker: 'TSLA',
      serverTsMs: Date.now(),
      lastSampleAgeMs: 100,
      stale: false,
    });

    exposureTracker = new ExposureTracker();
    orderRepository = {
      create: vi.fn((o) => o),
      save: vi.fn(async (o) => o),
      find: vi.fn().mockResolvedValue([]),
      findOneBy: vi.fn().mockResolvedValue(null),
    };
    accountService = {
      placeBet: vi.fn().mockResolvedValue(undefined),
      settleBet: vi.fn().mockResolvedValue(undefined),
      voidBet: vi.fn().mockResolvedValue(undefined),
    };
    events = {
      emitOrderUpdate: vi.fn().mockResolvedValue(undefined),
    };
    engineClient = {
      sendExposure: vi.fn(),
    };

    service = new OrderService(
      orderRepository as any,
      accountService as any,
      events as any,
      feedHealthStore,
      exposureTracker,
      engineClient as any,
      SIGNER_KEY,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([0, -1, 26, NaN])(
    'rejects amount %s with BAD_AMOUNT and never calls placeBet',
    async (amount) => {
      const cell = makeSignedCell();
      let caught: unknown;
      try {
        await service.placeOrder('user-1', {
          marketId: 'NVDA',
          amount: amount as any,
          cell,
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(OrderRejectedError);
      expect((caught as OrderRejectedError).reason).toBe('BAD_AMOUNT');
      expect(accountService.placeBet).not.toHaveBeenCalled();
      expect(events.emitOrderUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OrderStatus.REJECTED,
          reason: 'BAD_AMOUNT',
        }),
      );
    },
  );

  it('rejects marketId not NVDA/TSLA or different from cell.ticker with BAD_TICKER', async () => {
    const btcCell = makeSignedCell({ ticker: 'BTCUSDT' });
    await expect(
      service.placeOrder('user-1', {
        marketId: 'BTCUSDT',
        amount: '10',
        cell: btcCell,
      }),
    ).rejects.toMatchObject({ reason: 'BAD_TICKER' });

    const tslaCell = makeSignedCell({ ticker: 'TSLA' });
    await expect(
      service.placeOrder('user-1', {
        marketId: 'NVDA',
        amount: '10',
        cell: tslaCell,
      }),
    ).rejects.toMatchObject({ reason: 'BAD_TICKER' });

    expect(accountService.placeBet).not.toHaveBeenCalled();
  });

  it('rejects gridTs older than 1500 ms with STALE_QUOTE', async () => {
    const staleCell = makeSignedCell({ gridTs: Date.now() - 1501 });
    await expect(
      service.placeOrder('user-1', {
        marketId: 'NVDA',
        amount: '10',
        cell: staleCell,
      }),
    ).rejects.toMatchObject({ reason: 'STALE_QUOTE' });

    expect(accountService.placeBet).not.toHaveBeenCalled();
  });

  it('rejects startTs < now + 5000 with WINDOW_CLOSING', async () => {
    const closingCell = makeSignedCell({
      startTs: Date.now() + 4999,
      endTs: Date.now() + 9999,
    });
    await expect(
      service.placeOrder('user-1', {
        marketId: 'NVDA',
        amount: '10',
        cell: closingCell,
      }),
    ).rejects.toMatchObject({ reason: 'WINDOW_CLOSING' });

    expect(accountService.placeBet).not.toHaveBeenCalled();
  });

  it('rejects a tampered rewardRate with BAD_SIGNATURE', async () => {
    const cell = makeSignedCell();
    const tampered: Cell = { ...cell, rewardRate: '9.9900' };

    await expect(
      service.placeOrder('user-1', {
        marketId: 'NVDA',
        amount: '10',
        cell: tampered,
      }),
    ).rejects.toMatchObject({ reason: 'BAD_SIGNATURE' });

    expect(accountService.placeBet).not.toHaveBeenCalled();
  });

  it('rejects while FeedHealthStore.isStale(ticker) with FEED_PAUSED', async () => {
    feedHealthStore.updateHealth({
      type: 'health',
      ticker: 'NVDA',
      serverTsMs: Date.now(),
      lastSampleAgeMs: 4000,
      stale: true,
    });

    const cell = makeSignedCell({ ticker: 'NVDA' });
    await expect(
      service.placeOrder('user-1', {
        marketId: 'NVDA',
        amount: '10',
        cell,
      }),
    ).rejects.toMatchObject({ reason: 'FEED_PAUSED' });

    expect(accountService.placeBet).not.toHaveBeenCalled();
  });

  it('accepts a valid tap, calls placeBet once, and sends exposure amount*rewardRate for that cell', async () => {
    const cell = makeSignedCell({
      ticker: 'NVDA',
      startTs: Date.now() + 10_000,
      endTs: Date.now() + 15_000,
      lowerPrice: '157.50',
      upperPrice: '157.53',
      rewardRate: '2.3100',
    });

    const order = await service.placeOrder('user-1', {
      marketId: 'NVDA',
      amount: '25',
      cell,
    });

    expect(order.ticker).toBe('NVDA');
    expect(order.marketId).toBe('NVDA');
    expect(order.status).toBe(OrderStatus.OPEN);
    expect(accountService.placeBet).toHaveBeenCalledTimes(1);
    expect(accountService.placeBet).toHaveBeenCalledWith(
      'user-1',
      '25',
      'NVDA',
      order.orderId,
    );
    expect(order.orderId.startsWith(`user-1:${getCellId(cell)}:`)).toBe(true);
    expect(orderRepository.save).toHaveBeenCalledTimes(1);
    expect(engineClient.sendExposure).toHaveBeenCalledTimes(1);
    expect(engineClient.sendExposure).toHaveBeenCalledWith('NVDA', [
      {
        windowStartMs: cell.startTs,
        lowerCents: 15750,
        liability: 57.75,
      },
    ]);
    expect(events.emitOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OrderStatus.OPEN,
        ticker: 'NVDA',
        cellId: getCellId(cell),
      }),
    );
  });

  it('two taps on the same cell are both accepted', async () => {
    const cell = makeSignedCell();
    const cellId = getCellId(cell);

    const o1 = await service.placeOrder('user-1', {
      marketId: 'NVDA',
      amount: '5',
      cell,
    });
    const o2 = await service.placeOrder('user-1', {
      marketId: 'NVDA',
      amount: '10',
      cell,
    });

    expect(o1.status).toBe(OrderStatus.OPEN);
    expect(o2.status).toBe(OrderStatus.OPEN);
    expect(o1.orderId).not.toBe(o2.orderId);
    expect(o1.orderId.startsWith(`user-1:${cellId}:`)).toBe(true);
    expect(o2.orderId.startsWith(`user-1:${cellId}:`)).toBe(true);
    expect(accountService.placeBet).toHaveBeenCalledTimes(2);
    expect(exposureTracker.snapshot('NVDA')).toEqual([
      {
        windowStartMs: cell.startTs,
        lowerCents: 15750,
        liability: 34.65,
      },
    ]);
  });

  it('fifth $25 tap on one cell is rejected with CELL_LIMIT', async () => {
    const cell = makeSignedCell();
    for (let i = 0; i < 4; i++) {
      await service.placeOrder('user-1', {
        marketId: 'NVDA',
        amount: '25',
        cell,
      });
    }

    await expect(
      service.placeOrder('user-1', {
        marketId: 'NVDA',
        amount: '25',
        cell,
      }),
    ).rejects.toMatchObject({ reason: 'CELL_LIMIT' });

    expect(accountService.placeBet).toHaveBeenCalledTimes(4);
    expect(events.emitOrderUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: OrderStatus.REJECTED,
        reason: 'CELL_LIMIT',
        cellId: getCellId(cell),
      }),
    );
  });

  it('order_update echoes clientTapId and cellId on OPEN and REJECTED, and ignores invalid clientTapId', async () => {
    const cell = makeSignedCell();
    const cellId = getCellId(cell);

    const order = await service.placeOrder('user-1', {
      marketId: 'NVDA',
      amount: '10',
      cell,
      clientTapId: 'tap-abc-123',
    });

    expect(events.emitOrderUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderId: order.orderId,
        cellId,
        clientTapId: 'tap-abc-123',
        status: OrderStatus.OPEN,
      }),
    );

    await expect(
      service.placeOrder('user-1', {
        marketId: 'NVDA',
        amount: '0',
        cell,
        clientTapId: 'tap-bad-amt',
      }),
    ).rejects.toMatchObject({ reason: 'BAD_AMOUNT' });

    expect(events.emitOrderUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cellId,
        clientTapId: 'tap-bad-amt',
        status: OrderStatus.REJECTED,
        reason: 'BAD_AMOUNT',
      }),
    );
    const rejectedMsg = events.emitOrderUpdate.mock.calls.at(-1)![0];
    expect(rejectedMsg.orderId.startsWith(`user-1:${cellId}:`)).toBe(true);

    // Invalid clientTapId (>64 chars or invalid chars) is ignored, order still placed
    await service.placeOrder('user-1', {
      marketId: 'NVDA',
      amount: '10',
      cell,
      clientTapId: 'invalid_tap!@#',
    });
    const ignoredMsg = events.emitOrderUpdate.mock.calls.at(-1)![0];
    expect(ignoredMsg.status).toBe(OrderStatus.OPEN);
    expect(ignoredMsg.cellId).toBe(cellId);
    expect(ignoredMsg.clientTapId).toBeUndefined();

    await service.placeOrder('user-1', {
      marketId: 'NVDA',
      amount: '10',
      cell,
      clientTapId: 'a'.repeat(65),
    });
    const tooLongMsg = events.emitOrderUpdate.mock.calls.at(-1)![0];
    expect(tooLongMsg.status).toBe(OrderStatus.OPEN);
    expect(tooLongMsg.clientTapId).toBeUndefined();
  });

  it('rejects insufficient balance with INSUFFICIENT_BALANCE and preserves prior cell stake', async () => {
    const cell = makeSignedCell();
    await service.placeOrder('user-1', {
      marketId: 'NVDA',
      amount: '25',
      cell,
    });

    accountService.placeBet.mockRejectedValueOnce(
      new BadRequestException('Insufficient balance'),
    );

    await expect(
      service.placeOrder('user-1', {
        marketId: 'NVDA',
        amount: '25',
        cell,
      }),
    ).rejects.toMatchObject({ reason: 'INSUFFICIENT_BALANCE' });

    expect(events.emitOrderUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: OrderStatus.REJECTED,
        reason: 'INSUFFICIENT_BALANCE',
        cellId: getCellId(cell),
      }),
    );

    // Still has $25 open on cell, so 3 more $25 fit ($100) and a 4th rejects with CELL_LIMIT
    for (let i = 0; i < 3; i++) {
      await service.placeOrder('user-1', {
        marketId: 'NVDA',
        amount: '25',
        cell,
      });
    }
    await expect(
      service.placeOrder('user-1', {
        marketId: 'NVDA',
        amount: '1',
        cell,
      }),
    ).rejects.toMatchObject({ reason: 'CELL_LIMIT' });
  });
});
