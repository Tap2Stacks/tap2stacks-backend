import { Injectable } from '@nestjs/common';
import BigNumber from 'bignumber.js';
import { priceToCents } from 'src/libs/cell';
import { ExposureCell } from '../engine/engine.types';
import { Order } from './entities/order.entity';

interface TrackedOrderExposure {
    ticker: string;
    windowStartMs: number;
    lowerCents: number;
    liability: BigNumber;
}

@Injectable()
export class ExposureTracker {
    private readonly orders = new Map<string, TrackedOrderExposure>();

    add(order: Order): void {
        const ticker = order.ticker || order.marketId;
        const lowerCents = priceToCents(order.lowerPrice);
        const liability = new BigNumber(order.amount).times(order.rewardRate);

        this.orders.set(order.orderId, {
            ticker,
            windowStartMs: order.cellTimeStart,
            lowerCents,
            liability,
        });
    }

    remove(order: Pick<Order, 'orderId'>): void {
        this.orders.delete(order.orderId);
    }

    snapshot(ticker: string): ExposureCell[] {
        const cellsByKey = new Map<
            string,
            { windowStartMs: number; lowerCents: number; liability: BigNumber }
        >();

        for (const entry of this.orders.values()) {
            if (entry.ticker !== ticker) {
                continue;
            }
            const key = `${entry.windowStartMs}:${entry.lowerCents}`;
            const existing = cellsByKey.get(key);
            if (existing) {
                existing.liability = existing.liability.plus(entry.liability);
            } else {
                cellsByKey.set(key, {
                    windowStartMs: entry.windowStartMs,
                    lowerCents: entry.lowerCents,
                    liability: entry.liability,
                });
            }
        }

        const result: ExposureCell[] = [];
        for (const cell of cellsByKey.values()) {
            if (cell.liability.gt(0)) {
                result.push({
                    windowStartMs: cell.windowStartMs,
                    lowerCents: cell.lowerCents,
                    liability: cell.liability.toNumber(),
                });
            }
        }

        result.sort(
            (a, b) =>
                a.windowStartMs - b.windowStartMs ||
                a.lowerCents - b.lowerCents,
        );
        return result;
    }
}
