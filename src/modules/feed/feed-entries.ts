import BigNumber from 'bignumber.js';
import { buildCellFromOrder, getCellId } from 'src/libs/cell';
import { Order } from '../order/entities/order.entity';

export interface TradeFeedEntry {
  id: string;
  ticker: string;
  playerShort: string;
  isBot: boolean;
  multiplier: string;
  stake: string;
  payout: string;
  result: 'win' | 'loss';
  big: boolean;
  ts: number;
}
export interface SettledOrder {
  order: Order;
  win: boolean;
  ts: number;
}
export function shortAddress(address: string): string {
  const addr = address.toLowerCase();
  return `0x${addr.slice(2, 6)}..${addr.slice(-2)}`;
}
export function buildFeedEntries(
  settled: SettledOrder[],
  botWallets: string[],
): TradeFeedEntry[] {
  const groups = new Map<string, SettledOrder[]>();
  for (const item of settled) {
    const key = JSON.stringify([
      item.order.userId.toLowerCase(),
      getCellId(buildCellFromOrder(item.order)),
      item.ts,
    ]);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const bots = new Set(botWallets.map((wallet) => wallet.toLowerCase()));
  return Array.from(groups.values(), (group) => makeEntry(group, bots));
}
function makeEntry(group: SettledOrder[], bots: Set<string>): TradeFeedEntry {
  const { order, win, ts } = group[0];
  let stake = new BigNumber(0),
    payout = new BigNumber(0),
    weighted = new BigNumber(0);
  for (const item of group) {
    const amount = new BigNumber(item.order.amount);
    const gross = amount.times(item.order.rewardRate);
    stake = stake.plus(amount);
    weighted = weighted.plus(gross);
    if (item.win)
      payout = payout.plus(gross.decimalPlaces(6, BigNumber.ROUND_FLOOR));
  }
  const playerShort = shortAddress(order.userId);
  const cellId = getCellId(buildCellFromOrder(order));
  return {
    id: `${playerShort}:${cellId}:${ts}`,
    ticker: order.ticker || order.marketId,
    playerShort,
    isBot: bots.has(order.userId.toLowerCase()),
    multiplier: (win ? payout : weighted).dividedBy(stake).toFixed(1),
    stake: stake.toFixed(),
    payout: payout.toFixed(),
    result: win ? 'win' : 'loss',
    big: win && (stake.gte(25) || payout.gte(100)),
    ts,
  };
}
