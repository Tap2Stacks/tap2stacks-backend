import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  centsToPrice,
  getCellId,
  priceToCents,
  signCell,
  verifyCell,
} from './cell';

describe('cell helpers', () => {
  it('signCell uses | separators and includes ticker', () => {
    const c = {
      ticker: 'NVDA',
      gridTs: 1,
      startTs: 10000,
      endTs: 15000,
      lowerPrice: '157.50',
      upperPrice: '157.53',
      rewardRate: '2.3100',
    };
    expect(signCell(c, 'k')).toBe(
      createHmac('sha256', 'k')
        .update('NVDA|1|10000|15000|157.50|157.53|2.3100')
        .digest('hex'),
    );
  });

  it('verifyCell passes for valid signature and fails when ticker is swapped', () => {
    const base = {
      ticker: 'NVDA',
      gridTs: 1,
      startTs: 10000,
      endTs: 15000,
      lowerPrice: '157.50',
      upperPrice: '157.53',
      rewardRate: '2.3100',
    };
    const cell = {
      ...base,
      gridSignature: signCell(base, 'secret-key'),
    };

    expect(verifyCell(cell, 'secret-key')).toBe(true);
    expect(verifyCell({ ...cell, ticker: 'TSLA' }, 'secret-key')).toBe(false);
    expect(verifyCell(cell, 'wrong-key')).toBe(false);
    expect(verifyCell({ ...cell, gridSignature: 'short' }, 'secret-key')).toBe(
      false,
    );
  });

  it('getCellId includes ticker and cell bounds', () => {
    expect(
      getCellId({
        ticker: 'TSLA',
        startTs: 10000,
        endTs: 15000,
        lowerPrice: '250.00',
        upperPrice: '250.50',
      }),
    ).toBe('TSLA:10000:15000:250.00:250.50');
  });

  it('centsToPrice and priceToCents convert accurately', () => {
    expect(centsToPrice(15750)).toBe('157.50');
    expect(centsToPrice(15753)).toBe('157.53');
    expect(centsToPrice(3)).toBe('0.03');
    expect(centsToPrice(100)).toBe('1.00');
    expect(centsToPrice(150)).toBe('1.50');
    expect(centsToPrice(707600)).toBe('7076.00');

    expect(priceToCents('157.50')).toBe(15750);
    expect(priceToCents('19.99')).toBe(1999);
    expect(priceToCents('0.03')).toBe(3);
    expect(priceToCents('7076.50')).toBe(707650);
  });
});
