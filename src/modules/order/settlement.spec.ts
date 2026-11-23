import { describe, expect, it, vi, beforeEach } from 'vitest';

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

import { Cell, signCell } from 'src/libs/cell';
import { FeedHealthStore } from '../engine/feed-health.store';
import { AccountService } from '../account/account.service';
import { EconomicEventType } from '../account/types';
import { OrderService } from './order.service';
import { ExposureTracker } from './exposure.tracker';
import { Order } from './entities/order.entity';
import { OrderStatus } from './types';

const SIGNER_KEY = 'test-cell-signer-key';

describe('OrderService settlement & void', () => {
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
    emitBalanceUpdate: ReturnType<typeof vi.fn>;
    emitTradeFeed: ReturnType<typeof vi.fn>;
  };
  let engineClient: {
    sendExposure: ReturnType<typeof vi.fn>;
  };
  let service: OrderService;

  const baseWindowStart = 1795000010000;
  const baseWindowEnd = 1795000015000;

  function makeOrder(overrides: Partial<Order> = {}): Order {
    return {
      orderId: 'user-1:NVDA:1795000010000:1795000015000:157.50:157.53',
      userId: 'user-1',
      marketId: 'NVDA',
      ticker: 'NVDA',
      cellTimeStart: baseWindowStart,
      cellTimeEnd: baseWindowEnd,
      lowerPrice: '157.50',
      upperPrice: '157.53',
      amount: '10',
      rewardRate: '2.3100',
      placedAt: baseWindowStart - 10_000,
      status: OrderStatus.OPEN,
      ...overrides,
    };
  }

  async function placeViaService(overrides: Partial<Cell> = {}, amount = '10') {
    const ticker = overrides.ticker ?? 'NVDA';
    const gridTs = overrides.gridTs ?? baseWindowStart - 10_000;
    vi.setSystemTime(new Date(gridTs + 50));

    const unsigned: Omit<Cell, 'gridSignature'> = {
      ticker,
      gridTs,
      startTs: baseWindowStart,
      endTs: baseWindowEnd,
      lowerPrice: '157.50',
      upperPrice: '157.53',
      rewardRate: '2.3100',
      ...overrides,
    };
    const cell: Cell = {
      ...unsigned,
      gridSignature: signCell(unsigned, SIGNER_KEY),
    };
    return service.placeOrder('user-1', {
      marketId: ticker,
      amount,
      cell,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(baseWindowStart - 10_000));

    feedHealthStore = new FeedHealthStore();
    feedHealthStore.markConnected(baseWindowStart - 20_000);

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
      emitBalanceUpdate: vi.fn().mockResolvedValue(undefined),
      emitTradeFeed: vi.fn().mockResolvedValue(undefined),
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
      { assertTradingAttestation: vi.fn().mockResolvedValue(undefined) } as any,
      SIGNER_KEY,
    );
  });

  it('emits one public entry for a stack after both orders settle', async () => {
    await placeViaService({}, '5');
    await placeViaService({}, '10');
    await service.handleSample({ ticker: 'NVDA', tsMs: baseWindowStart + 1000, price: 157.52 });
    expect(accountService.settleBet).toHaveBeenCalledTimes(2);
    expect(events.emitTradeFeed).toHaveBeenCalledTimes(1);
    expect(events.emitTradeFeed.mock.calls[0][0]).toMatchObject({ stake: '15', result: 'win' });
  });

  it('wins on the first sample in the window inside [lower, upper] cents', async () => {
    const order = await placeViaService();
    engineClient.sendExposure.mockClear();

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: baseWindowStart + 1000,
      price: 157.52,
    });

    expect(accountService.settleBet).toHaveBeenCalledTimes(1);
    expect(accountService.settleBet).toHaveBeenCalledWith(
      'user-1',
      '10',
      true,
      '2.3100',
      'NVDA',
      expect.any(String),
    );
    expect(order.status).toBe(OrderStatus.SETTLED);
    expect(order.settledWin).toBe(true);
    expect(events.emitOrderUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderId: order.orderId,
        ticker: 'NVDA',
        status: OrderStatus.SETTLED,
        settledWin: true,
      }),
    );
    expect(exposureTracker.snapshot('NVDA')).toEqual([]);
    expect(engineClient.sendExposure).toHaveBeenCalledWith('NVDA', []);
  });

  it('counts a sample exactly on upperCents as a win', async () => {
    const order = await placeViaService();

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: baseWindowStart,
      price: 157.53,
    });

    expect(accountService.settleBet).toHaveBeenCalledWith(
      'user-1',
      '10',
      true,
      '2.3100',
      'NVDA',
      expect.any(String),
    );
    expect(order.status).toBe(OrderStatus.SETTLED);
    expect(order.settledWin).toBe(true);
  });

  it('loses when a sample at or after windowEnd arrives with no touch', async () => {
    const order = await placeViaService();

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: baseWindowStart + 1000,
      price: 158.0,
    });
    await service.handleSample({
      ticker: 'NVDA',
      tsMs: baseWindowStart + 3000,
      price: 158.1,
    });
    expect(order.status).toBe(OrderStatus.OPEN);

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: baseWindowEnd,
      price: 157.51, // exactly at windowEndMs is outside [windowStartMs, windowEndMs)
    });

    expect(accountService.settleBet).toHaveBeenCalledWith(
      'user-1',
      '10',
      false,
      '2.3100',
      'NVDA',
      expect.any(String),
    );
    expect(order.status).toBe(OrderStatus.SETTLED);
    expect(order.settledWin).toBe(false);
    expect(exposureTracker.snapshot('NVDA')).toEqual([]);
  });

  it('ignores samples for the other ticker', async () => {
    const order = await placeViaService({ ticker: 'NVDA' });

    await service.handleSample({
      ticker: 'TSLA',
      tsMs: baseWindowStart + 1000,
      price: 157.51,
    });
    await service.handleSample({
      ticker: 'TSLA',
      tsMs: baseWindowEnd + 1000,
      price: 157.51,
    });

    expect(order.status).toBe(OrderStatus.OPEN);
    expect(accountService.settleBet).not.toHaveBeenCalled();
    expect(accountService.voidBet).not.toHaveBeenCalled();
  });

  it('voids and refunds when consecutive samples are > 3000 ms apart across the window', async () => {
    const order = await placeViaService();
    engineClient.sendExposure.mockClear();

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: baseWindowStart + 500,
      price: 158.0,
    });
    expect(order.status).toBe(OrderStatus.OPEN);

    // 3500ms gap inside the window (even if price touches!)
    await service.handleSample({
      ticker: 'NVDA',
      tsMs: baseWindowStart + 4000,
      price: 157.51,
    });

    expect(accountService.settleBet).not.toHaveBeenCalled();
    expect(accountService.voidBet).toHaveBeenCalledTimes(1);
    expect(order.status).toBe(OrderStatus.VOIDED);
    expect(events.emitOrderUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderId: order.orderId,
        ticker: 'NVDA',
        status: OrderStatus.VOIDED,
      }),
    );
    expect(exposureTracker.snapshot('NVDA')).toEqual([]);
    expect(engineClient.sendExposure).toHaveBeenCalledWith('NVDA', []);
  });

  it('voids when the engine was disconnected during the window', async () => {
    const order = await placeViaService();

    feedHealthStore.markDisconnected(baseWindowStart + 1000);
    feedHealthStore.markConnected(baseWindowStart + 2500);

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: baseWindowStart + 2600,
      price: 157.51,
    });

    expect(accountService.settleBet).not.toHaveBeenCalled();
    expect(accountService.voidBet).toHaveBeenCalledTimes(1);
    expect(order.status).toBe(OrderStatus.VOIDED);

    // Also verify mid-window disconnect sweep voids open orders even if no sample arrives
    const order2 = await placeViaService({
      lowerPrice: '159.00',
      upperPrice: '159.03',
    });
    feedHealthStore.markDisconnected(baseWindowStart + 1500);

    await service.voidStaleOrders(baseWindowStart + 2000);

    expect(order2.status).toBe(OrderStatus.VOIDED);
    expect(accountService.voidBet).toHaveBeenCalledTimes(2);
  });

  it('pays amount * rewardRate rounded down to 6 decimals', async () => {
    // Test real AccountService.settleBet and AccountService.voidBet
    const balances = new Map<string, any>();
    const ledgerEntries: any[] = [];
    const shardQueue = {
      enqueue: vi.fn((_u, fn) => fn()),
      getShardId: vi.fn(() => 0),
    };
    const wal = {
      appendPrepare: vi.fn().mockResolvedValue('wal-1'),
      appendCommit: vi.fn().mockResolvedValue(undefined),
      appendAbort: vi.fn().mockResolvedValue(undefined),
    };
    const ledger = {
      append: vi.fn(async (userId, eventType, economicKey, deltas) => {
        const entry = {
          id: `entry-${ledgerEntries.length + 1}`,
          userId,
          eventType,
          economicKey,
          deltas,
        };
        ledgerEntries.push(entry);
        return entry;
      }),
      buildNextSnapshot: vi.fn(async () => ({
        ledgerSeq: '0',
        balanceAfter: { free: '100', freeTap: '0', locked: '0' },
      })),
    };
    const balanceStore = {
      get: vi.fn((userId) => balances.get(userId)),
      set: vi.fn((userId, state) => balances.set(userId, state)),
      applyDelta: vi.fn((userId, id, delta) => {
        const cur = balances.get(userId);
        cur.free = String(Number(cur.free) + Number(delta.free));
        cur.freeTap = String(Number(cur.freeTap) + Number(delta.freeTap));
        cur.locked = String(Number(cur.locked) + Number(delta.locked));
        cur.lastLedgerSeq = id;
      }),
    };

    const realAccount = new AccountService(
      shardQueue as any,
      wal as any,
      ledger as any,
      balanceStore as any,
      events as any,
    );

    await realAccount.placeBet('user-1', '3.333333', 'NVDA', 'cell-1');
    // 3.333333 * 2.3111 = 7.7036658963 -> rounded down to 6 decimals = 7.703665
    await realAccount.settleBet(
      'user-1',
      '3.333333',
      true,
      '2.3111',
      'NVDA',
      'cell-1',
    );

    const settleEntry = ledgerEntries.find(
      (e) => e.eventType === EconomicEventType.BET_SETTLE,
    );
    expect(settleEntry.deltas.free).toBe('7.703665');

    // Also test voidBet unlocks stake with economic key userId:void:<cellId>
    await realAccount.placeBet('user-1', '5', 'NVDA', 'cell-2');
    await realAccount.voidBet('user-1', '5', 'NVDA', 'cell-2');

    const voidEntry = ledgerEntries.find(
      (e) => e.economicKey === 'user-1:void:cell-2',
    );
    expect(voidEntry).toBeDefined();
    expect(voidEntry.deltas).toEqual({
      locked: '-5',
      free: '5',
      freeTap: '0',
    });
  });

  it('reloads OPEN orders on startup and settles them on the next sample', async () => {
    const nvdaOrder = makeOrder({
      orderId: 'user-1:NVDA:1795000010000:1795000015000:157.50:157.53',
      ticker: 'NVDA',
      marketId: 'NVDA',
    });
    const tslaOrder = makeOrder({
      orderId: 'user-1:TSLA:1795000010000:1795000015000:250.00:250.03',
      ticker: 'TSLA',
      marketId: 'TSLA',
      lowerPrice: '250.00',
      upperPrice: '250.03',
    });
    orderRepository.find.mockResolvedValueOnce([nvdaOrder, tslaOrder]);

    await service.onModuleInit();

    expect(exposureTracker.snapshot('NVDA')).toHaveLength(1);
    expect(exposureTracker.snapshot('TSLA')).toHaveLength(1);

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: baseWindowStart + 1000,
      price: 157.51,
    });

    expect(nvdaOrder.status).toBe(OrderStatus.SETTLED);
    expect(nvdaOrder.settledWin).toBe(true);
    expect(tslaOrder.status).toBe(OrderStatus.OPEN);

    await service.handleSample({
      ticker: 'TSLA',
      tsMs: baseWindowEnd,
      price: 260.0,
    });

    expect(tslaOrder.status).toBe(OrderStatus.SETTLED);
    expect(tslaOrder.settledWin).toBe(false);
  });

  it('crossing between two samples wins', async () => {
    const order = await placeViaService({
      gridTs: 4_000,
      startTs: 10_000,
      endTs: 15_000,
      lowerPrice: '154.61',
      upperPrice: '154.64',
    });

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: 9_800,
      price: 154.5,
    });
    expect(order.status).toBe(OrderStatus.OPEN);

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: 10_400,
      price: 154.7,
    });

    expect(order.status).toBe(OrderStatus.SETTLED);
    expect(order.settledWin).toBe(true);
    expect(order.settledAt).toBe(10_400);
    expect(accountService.settleBet).toHaveBeenCalledWith(
      'user-1',
      '10',
      true,
      '2.3100',
      'NVDA',
      order.orderId,
    );
  });

  it('crossing outside the window does not count', async () => {
    const order = await placeViaService({
      gridTs: 4_000,
      startTs: 10_000,
      endTs: 15_000,
      lowerPrice: '154.61',
      upperPrice: '154.64',
    });

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: 9_800,
      price: 154.5,
    });
    await service.handleSample({
      ticker: 'NVDA',
      tsMs: 12_500,
      price: 154.5,
    });
    await service.handleSample({
      ticker: 'NVDA',
      tsMs: 14_900,
      price: 154.5,
    });
    expect(order.status).toBe(OrderStatus.OPEN);

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: 15_100,
      price: 154.7,
    });

    expect(order.status).toBe(OrderStatus.SETTLED);
    expect(order.settledWin).toBe(false);
  });

  it('gap over 3 s resets the segment', async () => {
    const orderInGap = await placeViaService({
      gridTs: 9_000,
      startTs: 15_000,
      endTs: 20_000,
      lowerPrice: '154.55',
      upperPrice: '154.58',
    });
    const orderAfterGap = await placeViaService({
      gridTs: 9_000,
      startTs: 15_000,
      endTs: 20_000,
      lowerPrice: '154.72',
      upperPrice: '154.75',
    });

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: 10_000,
      price: 154.5,
    });
    await service.handleSample({
      ticker: 'NVDA',
      tsMs: 13_200,
      price: 154.7,
    });
    await service.handleSample({
      ticker: 'NVDA',
      tsMs: 15_100,
      price: 154.8,
    });

    expect(orderInGap.status).toBe(OrderStatus.OPEN);
    expect(orderAfterGap.status).toBe(OrderStatus.SETTLED);
    expect(orderAfterGap.settledWin).toBe(true);
  });

  it('out-of-order sample counts as a point and does not move the previous price', async () => {
    const order = await placeViaService({
      gridTs: 4_000,
      startTs: 10_000,
      endTs: 15_000,
      lowerPrice: '154.65',
      upperPrice: '154.68',
    });

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: 11_000,
      price: 154.5,
    });

    // Out-of-order sample: 154.75 is outside [154.65, 154.68] as a point,
    // and must not move prevCents away from 154.50.
    await service.handleSample({
      ticker: 'NVDA',
      tsMs: 10_500,
      price: 154.75,
    });
    expect(order.status).toBe(OrderStatus.OPEN);

    // In-order sample at 154.70 forms segment 154.50 -> 154.70, crossing [154.65, 154.68].
    await service.handleSample({
      ticker: 'NVDA',
      tsMs: 12_000,
      price: 154.7,
    });
    expect(order.status).toBe(OrderStatus.SETTLED);
    expect(order.settledWin).toBe(true);
  });

  it('all coins on a cell settle on the same touching sample', async () => {
    const order1 = await placeViaService({}, '5');
    const order2 = await placeViaService({}, '10');

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: baseWindowStart + 1000,
      price: 157.52,
    });

    expect(order1.status).toBe(OrderStatus.SETTLED);
    expect(order1.settledWin).toBe(true);
    expect(order2.status).toBe(OrderStatus.SETTLED);
    expect(order2.settledWin).toBe(true);
    expect(accountService.settleBet).toHaveBeenCalledTimes(2);
  });

  it('cell stake is released on settle and void', async () => {
    for (let i = 0; i < 4; i++) {
      await placeViaService({}, '25');
    }
    await expect(placeViaService({}, '1')).rejects.toMatchObject({
      reason: 'CELL_LIMIT',
    });

    await service.handleSample({
      ticker: 'NVDA',
      tsMs: baseWindowStart + 1000,
      price: 157.52,
    });

    // All $100 settled -> stake released, can place $100 again on the same cell
    const rePlacedOrders = [];
    for (let i = 0; i < 4; i++) {
      const rePlaced = await placeViaService({}, '25');
      expect(rePlaced.status).toBe(OrderStatus.OPEN);
      rePlacedOrders.push(rePlaced);
    }
    await expect(placeViaService({}, '1')).rejects.toMatchObject({
      reason: 'CELL_LIMIT',
    });

    // Now void via disconnect overlapping [baseWindowStart, baseWindowEnd) and verify stake is released again
    feedHealthStore.markDisconnected(baseWindowStart + 500);
    await service.voidStaleOrders(baseWindowStart + 1000);
    feedHealthStore.markConnected(baseWindowStart + 1200);
    for (const o of rePlacedOrders) {
      expect(o.status).toBe(OrderStatus.VOIDED);
    }

    for (let i = 0; i < 4; i++) {
      const afterVoid = await placeViaService({}, '25');
      expect(afterVoid.status).toBe(OrderStatus.OPEN);
    }
  });

  it('reload after restart rebuilds cell stakes from open orders', async () => {
    const orderA = makeOrder({
      orderId: 'user-1:NVDA:1795000010000:1795000015000:157.50:157.53:uuid-1',
      amount: '25',
    });
    const orderB = makeOrder({
      orderId: 'user-1:NVDA:1795000010000:1795000015000:157.50:157.53:uuid-2',
      amount: '25',
    });
    const orderC = makeOrder({
      orderId: 'user-1:NVDA:1795000010000:1795000015000:157.50:157.53:uuid-3',
      amount: '25',
    });
    orderRepository.find.mockResolvedValueOnce([orderA, orderB, orderC]);

    await service.onModuleInit();

    // $75 already open -> $25 fits, next $1 hits CELL_LIMIT
    const fourth = await placeViaService({}, '25');
    expect(fourth.status).toBe(OrderStatus.OPEN);

    await expect(placeViaService({}, '1')).rejects.toMatchObject({
      reason: 'CELL_LIMIT',
    });
  });
});
