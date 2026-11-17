export enum OrderStatus {
    OPEN = 'OPEN',
    SETTLED = 'SETTLED',
    REJECTED = 'REJECTED',
    VOIDED = 'VOIDED',
}

export type RejectReason =
    | 'BAD_TICKER'
    | 'BAD_AMOUNT'
    | 'STALE_QUOTE'
    | 'WINDOW_CLOSING'
    | 'BAD_SIGNATURE'
    | 'FEED_PAUSED'
    | 'RATE_LIMITED'
    | 'CELL_LIMIT'
    | 'INSUFFICIENT_BALANCE';

export class OrderRejectedError extends Error {
    readonly reason: RejectReason;

    constructor(reason: RejectReason, message?: string) {
        super(message ?? `Order rejected: ${reason}`);
        this.name = 'OrderRejectedError';
        this.reason = reason;
    }
}
