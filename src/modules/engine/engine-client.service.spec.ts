import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { AddressInfo } from 'net';
import { EngineClientService } from './engine-client.service';
import { LatestQuoteStore } from './latest-quote.store';
import { FeedHealthStore } from './feed-health.store';
import { ExposurePublisher } from './exposure.publisher';
import { GridPublisherService } from './grid-publisher.service';
import { EngineExposureMessage } from './engine.types';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  stepMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await delay(stepMs);
  }
}

describe('EngineClientService', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  async function startStubServer() {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => wss.once('listening', resolve));
    const port = (wss.address() as AddressInfo).port;
    const headersSeen: Array<Record<string, string | string[] | undefined>> = [];
    const sockets: WebSocket[] = [];
    const receivedFrames: string[] = [];

    wss.on('connection', (ws, req) => {
      headersSeen.push(req.headers);
      sockets.push(ws);
      ws.on('message', (data) => {
        receivedFrames.push(data.toString());
      });
    });

    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          for (const s of sockets) {
            s.terminate();
          }
          wss.close(() => resolve());
        }),
    );

    return {
      wss,
      url: `ws://127.0.0.1:${port}`,
      headersSeen,
      sockets,
      receivedFrames,
    };
  }

  function createService(url: string, overrides?: { initialBackoffMs?: number; maxBackoffMs?: number }) {
    const events = {
      emitGridUpdate: vi.fn().mockResolvedValue(undefined),
      emitPriceNow: vi.fn().mockResolvedValue(undefined),
      emitFeedHealth: vi.fn().mockResolvedValue(undefined),
    };
    const priceSampleRepo = {
      save: vi.fn().mockResolvedValue(undefined),
    };
    const latestQuoteStore = new LatestQuoteStore();
    const feedHealthStore = new FeedHealthStore();
    const exposurePublisher = new ExposurePublisher(100);
    const gridPublisher = new GridPublisherService(events as any, 'test-key');

    const client = new EngineClientService(
      latestQuoteStore,
      feedHealthStore,
      exposurePublisher,
      gridPublisher,
      priceSampleRepo as any,
      events as any,
      {
        url,
        token: 'secret-engine-token',
        ...(overrides ?? {}),
      },
    );

    cleanups.push(() => {
      client.onModuleDestroy();
      exposurePublisher.onModuleDestroy();
    });

    return {
      client,
      events,
      priceSampleRepo,
      latestQuoteStore,
      feedHealthStore,
    };
  }

  it('connects with x-engine-token and reconnects after the stub server closes', async () => {
    const server = await startStubServer();
    const { client } = createService(server.url, {
      initialBackoffMs: 20,
      maxBackoffMs: 80,
    });

    client.connect();
    await waitFor(() => server.sockets.length === 1);

    expect(server.headersSeen[0]['x-engine-token']).toBe('secret-engine-token');

    // Close the first server-side connection to force reconnect
    server.sockets[0].close();

    await waitFor(() => server.sockets.length >= 2);
    expect(server.headersSeen[1]['x-engine-token']).toBe('secret-engine-token');
  });

  it('marks feed stale while disconnected and records the interval', async () => {
    const server = await startStubServer();
    const { client, events, feedHealthStore } = createService(server.url, {
      initialBackoffMs: 80,
      maxBackoffMs: 160,
    });

    client.connect();
    await waitFor(() => server.sockets.length === 1);

    server.sockets[0].send(
      JSON.stringify({
        type: 'health',
        ticker: 'NVDA',
        serverTsMs: 1795000001000,
        lastSampleAgeMs: 127,
        stale: false,
      }),
    );

    await waitFor(() => events.emitFeedHealth.mock.calls.length === 1);
    expect(feedHealthStore.isStale('NVDA')).toBe(false);
    expect(events.emitFeedHealth).toHaveBeenLastCalledWith({
      ticker: 'NVDA',
      stale: false,
      prevDayPx: null,
    });

    // Disconnect engine
    server.sockets[0].close();

    await waitFor(() => feedHealthStore.isStale('NVDA') === true);
    expect(events.emitFeedHealth).toHaveBeenLastCalledWith({
      ticker: 'NVDA',
      stale: true,
      prevDayPx: null,
    });
    const whileDownIntervals = feedHealthStore.staleIntervals('NVDA');
    expect(whileDownIntervals.length).toBeGreaterThanOrEqual(1);

    // Wait for reconnect
    await waitFor(() => server.sockets.length === 2);
    const afterReconnectIntervals = feedHealthStore.staleIntervals('NVDA');
    expect(afterReconnectIntervals.length).toBeGreaterThanOrEqual(1);
    const [fromMs, toMs] =
      afterReconnectIntervals[afterReconnectIntervals.length - 1];
    expect(fromMs).toBeLessThanOrEqual(toMs);
  });

  it('debounces exposure to one frame per 100 ms per ticker with the latest full set', async () => {
    const server = await startStubServer();
    const { client } = createService(server.url);

    client.connect();
    await waitFor(() => server.sockets.length === 1);

    client.sendExposure('NVDA', [
      { windowStartMs: 1795000010000, lowerCents: 15750, liability: 10 },
    ]);
    client.sendExposure('NVDA', [
      { windowStartMs: 1795000010000, lowerCents: 15750, liability: 57.75 },
    ]);
    client.sendExposure('TSLA', [
      { windowStartMs: 1795000010000, lowerCents: 25000, liability: 20 },
    ]);

    expect(server.receivedFrames).toHaveLength(0);

    await delay(150);

    expect(server.receivedFrames).toHaveLength(2);
    const parsed: EngineExposureMessage[] = server.receivedFrames.map((f) =>
      JSON.parse(f),
    );
    const nvda = parsed.find((m) => m.ticker === 'NVDA');
    const tsla = parsed.find((m) => m.ticker === 'TSLA');

    expect(nvda).toEqual({
      type: 'exposure',
      ticker: 'NVDA',
      cells: [
        { windowStartMs: 1795000010000, lowerCents: 15750, liability: 57.75 },
      ],
    });
    expect(tsla).toEqual({
      type: 'exposure',
      ticker: 'TSLA',
      cells: [
        { windowStartMs: 1795000010000, lowerCents: 25000, liability: 20 },
      ],
    });
  });

  it('handles quote and sample frames and uses 1s->30s default backoff', async () => {
    const server = await startStubServer();
    const { client, events, priceSampleRepo, latestQuoteStore } = createService(
      server.url,
    );

    expect(client.getBackoffDelayMs(0)).toBe(1000);
    expect(client.getBackoffDelayMs(1)).toBe(2000);
    expect(client.getBackoffDelayMs(2)).toBe(4000);
    expect(client.getBackoffDelayMs(3)).toBe(8000);
    expect(client.getBackoffDelayMs(4)).toBe(16000);
    expect(client.getBackoffDelayMs(5)).toBe(30000);
    expect(client.getBackoffDelayMs(6)).toBe(30000);

    client.connect();
    await waitFor(() => server.sockets.length === 1);

    const samples: any[] = [];
    const sub = client.sample$.subscribe((s) => samples.push(s));
    cleanups.push(() => sub.unsubscribe());

    server.sockets[0].send(
      JSON.stringify({
        type: 'quote',
        ticker: 'NVDA',
        serverTsMs: 1795000000100,
        spot: 157.53,
        bandCents: 3,
        cells: [
          {
            windowStartMs: 1795000010000,
            windowEndMs: 1795000015000,
            lowerCents: 15750,
            upperCents: 15753,
            hitProbability: 0.41,
            multiplier: 2.31,
          },
        ],
      }),
    );

    server.sockets[0].send(
      JSON.stringify({
        type: 'sample',
        ticker: 'NVDA',
        tsMs: 1795000000873,
        price: 157.53,
      }),
    );

    await waitFor(() => samples.length === 1 && events.emitGridUpdate.mock.calls.length === 1);

    expect(latestQuoteStore.get('NVDA')?.spot).toBe(157.53);
    expect(priceSampleRepo.save).toHaveBeenCalledWith({
      ticker: 'NVDA',
      tsMs: 1795000000873,
      price: '157.53',
    });
    expect(events.emitPriceNow).toHaveBeenCalledWith({
      ticker: 'NVDA',
      price: '157.53',
      ts: 1795000000873,
    });
  });

  it('records engine-reported stale intervals and emits feed_health only on change', async () => {
    const server = await startStubServer();
    const { client, events, feedHealthStore } = createService(server.url);

    client.connect();
    await waitFor(() => server.sockets.length === 1);

    const healths: any[] = [];
    const sub = client.health$.subscribe((h) => healths.push(h));
    cleanups.push(() => sub.unsubscribe());

    server.sockets[0].send(
      JSON.stringify({
        type: 'health',
        ticker: 'TSLA',
        serverTsMs: 1000,
        lastSampleAgeMs: 100,
        stale: false,
      }),
    );
    server.sockets[0].send(
      JSON.stringify({
        type: 'health',
        ticker: 'TSLA',
        serverTsMs: 2000,
        lastSampleAgeMs: 200,
        stale: false,
      }),
    );
    server.sockets[0].send(
      JSON.stringify({
        type: 'health',
        ticker: 'TSLA',
        serverTsMs: 3000,
        lastSampleAgeMs: 3500,
        stale: true,
      }),
    );
    server.sockets[0].send(
      JSON.stringify({
        type: 'health',
        ticker: 'TSLA',
        serverTsMs: 7000,
        lastSampleAgeMs: 100,
        stale: false,
      }),
    );

    await waitFor(() => healths.length === 4);

    expect(events.emitFeedHealth).toHaveBeenCalledTimes(3);
    expect(events.emitFeedHealth.mock.calls.map((c) => c[0])).toEqual([
      { ticker: 'TSLA', stale: false, prevDayPx: null },
      { ticker: 'TSLA', stale: true, prevDayPx: null },
      { ticker: 'TSLA', stale: false, prevDayPx: null },
    ]);
    expect(feedHealthStore.isStale('TSLA')).toBe(false);
    expect(feedHealthStore.staleIntervals('TSLA')).toEqual([[3000, 7000]]);
  });
});
