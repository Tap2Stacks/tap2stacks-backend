import { describe, expect, it } from 'vitest';
import { buildFeedEntries, shortAddress } from './feed-entries';
import { Order } from '../order/entities/order.entity';

const address = '0x3F4A9b0000000000000000000000000000000Ca1';
const order = (amount: string, rewardRate: string): Order =>
  ({
    userId: address,
    marketId: 'NVDA',
    ticker: 'NVDA',
    cellTimeStart: 1,
    cellTimeEnd: 2,
    lowerPrice: '1.00',
    upperPrice: '2.00',
    amount,
    rewardRate,
  }) as Order;
const entries = (coins: Order[], win = true) =>
  buildFeedEntries(
    coins.map((order) => ({ order, win, ts: 10 })),
    [address.toLowerCase()],
  );
describe('trade feed entries', () => {
  it('groups coins, uses effective odds, and hides addresses', () => {
    const result = entries([order('5', '4.1'), order('10', '4.1')]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      stake: '15',
      payout: '61.5',
      multiplier: '4.1',
      result: 'win',
      isBot: true,
    });
    expect(JSON.stringify(result)).not.toContain(address);
    expect(shortAddress(address)).toBe('0x3f4a..a1');
    expect(entries([order('10', '3'), order('10', '5')])[0]).toMatchObject({
      payout: '80',
      multiplier: '4.0',
    });
  });
  it('handles loss, big wins, and per-coin payout rounding', () => {
    expect(
      entries([order('10', '3'), order('10', '5')], false)[0],
    ).toMatchObject({ payout: '0', multiplier: '4.0', big: false });
    expect(entries([order('25', '1')])[0].big).toBe(true);
    expect(entries([order('10', '10')])[0].big).toBe(true);
    expect(entries([order('10', '9.99')])[0].big).toBe(false);
    expect(
      entries([order('1', '1.0000009'), order('1', '1.0000009')])[0].payout,
    ).toBe('2');
  });
});
