import { describe, expect, it, vi } from 'vitest';
import { verifyCell } from 'src/libs/cell';
import { GridPublisherService } from './grid-publisher.service';
import { EngineQuote } from './engine.types';

describe('GridPublisherService', () => {
  it('publish maps engine cents to 2-decimal strings and 4-decimal rewardRate', async () => {
    const emitGridUpdate = vi.fn().mockResolvedValue(undefined);
    const publisher = { emitGridUpdate } as any;
    const signerKey = 'test-cell-signer-key';
    const service = new GridPublisherService(publisher, signerKey);

    const quote: EngineQuote = {
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
    };

    service.publish(quote);

    expect(emitGridUpdate).toHaveBeenCalledTimes(1);
    const payload = emitGridUpdate.mock.calls[0][0];
    expect(payload.ticker).toBe('NVDA');
    expect(payload.gridTs).toBe(1795000000100);
    expect(payload.priceStep).toBe('0.03');
    expect(payload.cells).toHaveLength(1);

    const cell = payload.cells[0];
    expect(cell).toMatchObject({
      ticker: 'NVDA',
      gridTs: 1795000000100,
      startTs: 1795000010000,
      endTs: 1795000015000,
      lowerPrice: '157.50',
      upperPrice: '157.53',
      rewardRate: '2.3100',
    });
    expect(verifyCell(cell, signerKey)).toBe(true);
  });
});
