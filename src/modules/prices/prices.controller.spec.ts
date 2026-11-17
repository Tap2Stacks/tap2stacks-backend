import { describe, expect, it, vi } from 'vitest';
import { PricesController } from './prices.controller';
import { FeedHealthStore } from '../engine/feed-health.store';

describe('recent prices', () => {
  it('rejects unknown tickers and clamps history, sorts and returns reference', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    const find = vi.fn().mockResolvedValue([
      { tsMs: 41000, price: '1.234' },
      { tsMs: 42000, price: '2' },
    ]);
    const store = new FeedHealthStore();
    store.updateHealth({
      ticker: 'NVDA',
      serverTsMs: 1,
      lastSampleAgeMs: null,
      stale: false,
      prevDayPx: 5,
    });
    const controller = new PricesController({ find } as any, store);
    await expect(controller.recent('BAD', '0')).rejects.toThrow();
    expect(await controller.recent('NVDA', '0')).toEqual({
      ticker: 'NVDA',
      prevDayPx: 5,
      points: [
        { ts: 41000, price: '1.23' },
        { ts: 42000, price: '2.00' },
      ],
    });
    expect(find.mock.calls[0][0].take).toBe(600);
    vi.useRealTimers();
  });
  it('reports reference price changes', () => {
    const store = new FeedHealthStore();
    store.markConnected();
    const health = {
      ticker: 'TSLA',
      serverTsMs: 1,
      lastSampleAgeMs: null,
      stale: false,
      prevDayPx: 10,
    };
    expect(store.updateHealth(health).changed).toBe(true);
    expect(store.updateHealth(health).changed).toBe(false);
    expect(store.updateHealth({ ...health, prevDayPx: 11 }).changed).toBe(true);
  });
});
