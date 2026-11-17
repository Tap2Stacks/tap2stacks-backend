import * as crypto from 'crypto';
import { ApiProperty } from '@nestjs/swagger';
import BigNumber from 'bignumber.js';
import { Order } from 'src/modules/order/entities/order.entity';

export class Cell {
    @ApiProperty({ type: String, required: false })
    ticker?: string;
    @ApiProperty({ type: Number })
    gridTs: number;
    @ApiProperty({ type: Number })
    startTs: number;
    @ApiProperty({ type: Number })
    endTs: number;
    @ApiProperty({ type: String })
    lowerPrice: string;
    @ApiProperty({ type: String })
    upperPrice: string;
    @ApiProperty({ type: String })
    rewardRate: string;
    @ApiProperty({ type: String })
    gridSignature: string;
}

export interface RemoteCell {
    ticker: string;
    gridTs: number;
    startTs: number;
    endTs: number;
    lowerPrice: string;
    upperPrice: string;
    rewardRate: string;
    gridSignature: string;
}

export type SignableCell = Omit<Cell, 'gridSignature'> & {
    gridSignature?: string;
};

export function getCellId(
    cell: Pick<Cell, 'ticker' | 'startTs' | 'endTs' | 'lowerPrice' | 'upperPrice'>,
): string {
    return `${cell.ticker}:${cell.startTs}:${cell.endTs}:${cell.lowerPrice}:${cell.upperPrice}`;
}

export function signCell(cell: SignableCell, key: string): string {
    const payload = [
        cell.ticker ?? '',
        cell.gridTs,
        cell.startTs,
        cell.endTs,
        cell.lowerPrice,
        cell.upperPrice,
        cell.rewardRate,
    ].join('|');

    return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

export function verifyCell(cell: Cell, key: string): boolean {
    if (!cell || typeof cell.gridSignature !== 'string' || !cell.gridSignature) {
        return false;
    }

    const expected = signCell(cell, key);
    const actualBuf = Buffer.from(cell.gridSignature, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');

    if (actualBuf.length !== expectedBuf.length) {
        return false;
    }

    return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export function centsToPrice(c: number): string {
    if (!Number.isFinite(c)) {
        throw new Error(`Invalid cents value: ${c}`);
    }
    return (Math.round(c) / 100).toFixed(2);
}

export function priceToCents(p: string): number {
    const trimmed = typeof p === 'string' ? p.trim() : '';
    if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
        throw new Error(`Invalid price string: ${p}`);
    }
    const n = new BigNumber(trimmed);
    if (!n.isFinite()) {
        throw new Error(`Invalid price string: ${p}`);
    }
    return n.times(100).integerValue(BigNumber.ROUND_HALF_UP).toNumber();
}

export function buildCellFromOrder(order: Order): Cell {
    return {
        ticker: order.marketId,
        gridTs: order.placedAt,
        startTs: order.cellTimeStart,
        endTs: order.cellTimeEnd,
        lowerPrice: order.lowerPrice,
        upperPrice: order.upperPrice,
        rewardRate: order.rewardRate,
        gridSignature: '',
    };
}
