import { buildFeedEntries, SettledOrder } from '../feed/feed-entries';
import { env } from 'src/config';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BigNumber } from 'bignumber.js';
import {
  buildCellFromOrder,
  getCellId,
  priceToCents,
  verifyCell,
} from 'src/libs/cell';
import { SUPPORTED_TICKER_SET } from 'src/libs/tickers';
import { TokenBucket } from 'src/libs/token-bucket';
import { Repository } from 'typeorm';
import { uuidv7 } from 'uuidv7';
import { segmentTouchesBand } from 'src/libs/touch';
import { AccountService } from '../account/account.service';
import { EngineClientService } from '../engine/engine-client.service';
import { CELL_SIGNER_KEY_TOKEN, EngineSample } from '../engine/engine.types';
import { FeedHealthStore } from '../engine/feed-health.store';
import {
  EVENT_PUBLISHER,
  EventPublisher,
  OrderUpdateMessage,
} from '../socket/types';
import { PlaceOrderDto } from './dto/place-order.dto';
import { Order } from './entities/order.entity';
import { ExposureTracker } from './exposure.tracker';
import { OrderRejectedError, OrderStatus, RejectReason } from './types';

export { OrderRejectedError, RejectReason };

const ALLOWED_TICKERS = SUPPORTED_TICKER_SET;
const MIN_STAKE = 1;
const MAX_STAKE = 25;
export const MAX_CELL_STAKE = 100;
const QUOTE_FRESHNESS_MS = 1500;
const WINDOW_LEAD_TIME_MS = 5000;
const VOID_GAP_MS = 3000;
const CLIENT_TAP_ID_RE = /^[A-Za-z0-9-]+$/;

function sanitizeClientTapId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  if (raw.length === 0 || raw.length > 64 || !CLIENT_TAP_ID_RE.test(raw)) {
    return undefined;
  }
  return raw;
}

function intervalOverlapsWindow(
  from: number,
  to: number,
  windowStartMs: number,
  windowEndMs: number,
): boolean {
  if (from === to) {
    return from >= windowStartMs && from < windowEndMs;
  }
  return from < windowEndMs && to > windowStartMs;
}

@Injectable()
export class OrderService implements OnModuleInit {
  private readonly logger = new Logger(OrderService.name);

  private userCellStake = new Map<string, Map<string, number>>();
  private activeOrdersByBucket = new Map<string, Map<string, Order>>();
  private rateLimiters = new Map<string, TokenBucket>();
  private readonly lastSampleTsByTicker = new Map<string, number>();
  private readonly lastPriceCentsByTicker = new Map<string, number>();
  private readonly tickerQueues = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly accountService: AccountService,
    @Inject(EVENT_PUBLISHER)
    private readonly events: EventPublisher,
    private readonly feedHealthStore: FeedHealthStore,
    private readonly exposureTracker: ExposureTracker,
    private readonly engineClient: EngineClientService,
    @Optional()
    @Inject(CELL_SIGNER_KEY_TOKEN)
    private readonly cellSignerKey?: string,
  ) {}

  private getBucketKey(ticker: string, startTs: number): string {
    return `${ticker}:${startTs}`;
  }

  private getCellSignerKey(): string {
    return this.cellSignerKey ?? process.env.CELL_SIGNER_KEY ?? '';
  }

  private runSerializedForTicker<T>(
    ticker: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.tickerQueues.get(ticker) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    const next = result.then(
      () => undefined,
      () => undefined,
    );
    this.tickerQueues.set(ticker, next);
    return result;
  }

  async onModuleInit() {
    this.logger.debug('Initializing OrderService');
    const activeOrders = await this.getPeristedActiveOrders();
    this.logger.debug(`Loaded ${activeOrders.length} active orders from DB`);
    this.activeOrdersByBucket = this.buildActiveOrdersByBucket(activeOrders);
    this.userCellStake = this.buildUserCellStake(activeOrders);
    for (const order of activeOrders) {
      this.exposureTracker.add(order);
    }
  }

  buildActiveOrdersByBucket(activeOrders: Order[]) {
    const bucketMap = new Map<string, Map<string, Order>>();
    for (const order of activeOrders) {
      const ticker = order.ticker || order.marketId;
      const bucketKey = this.getBucketKey(ticker, order.cellTimeStart);
      let bucket = bucketMap.get(bucketKey);
      if (!bucket) {
        bucket = new Map();
        bucketMap.set(bucketKey, bucket);
      }
      bucket.set(order.orderId, order);
    }
    return bucketMap;
  }

  buildUserCellStake(activeOrders: Order[]): Map<string, Map<string, number>> {
    const userCellStake = new Map<string, Map<string, number>>();
    for (const order of activeOrders) {
      let userCells = userCellStake.get(order.userId);
      if (!userCells) {
        userCells = new Map();
        userCellStake.set(order.userId, userCells);
      }
      const cellId = getCellId(buildCellFromOrder(order));
      const current = userCells.get(cellId) ?? 0;
      userCells.set(
        cellId,
        new BigNumber(current).plus(order.amount).toNumber(),
      );
    }
    return userCellStake;
  }

  private adjustUserCellStake(
    userId: string,
    cellId: string,
    delta: BigNumber.Value,
  ): void {
    let userCells = this.userCellStake.get(userId);
    const current = userCells?.get(cellId) ?? 0;
    const next = new BigNumber(current).plus(delta);
    if (next.lte(0)) {
      if (userCells) {
        userCells.delete(cellId);
        if (userCells.size === 0) {
          this.userCellStake.delete(userId);
        }
      }
      return;
    }
    if (!userCells) {
      userCells = new Map();
      this.userCellStake.set(userId, userCells);
    }
    userCells.set(cellId, next.toNumber());
  }

  private async rejectOrder(
    userId: string,
    dto: PlaceOrderDto,
    reason: RejectReason,
    message?: string,
  ): Promise<never> {
    const ticker = dto?.marketId ?? dto?.cell?.ticker ?? '';
    const cellId = dto?.cell ? getCellId(dto.cell) : '';
    const orderId = `${userId}:${cellId}:${uuidv7()}`;
    const clientTapId = sanitizeClientTapId(dto?.clientTapId);
    await this.events.emitOrderUpdate({
      orderId,
      userId,
      marketId: dto?.marketId ?? '',
      ticker,
      cellId,
      ...(clientTapId !== undefined ? { clientTapId } : {}),
      amount: String(dto?.amount ?? ''),
      cell: dto?.cell,
      status: OrderStatus.REJECTED,
      reason,
    });
    throw new OrderRejectedError(reason, message);
  }

  async placeOrder(userId: string, dto: PlaceOrderDto): Promise<Order> {
    // 1. Amount check (cheapest)
    const rawAmount = dto?.amount as unknown;
    const amountBn =
      typeof rawAmount === 'number' || typeof rawAmount === 'string'
        ? new BigNumber(
            typeof rawAmount === 'string' ? rawAmount.trim() : rawAmount,
          )
        : new BigNumber(NaN);
    if (
      (typeof rawAmount === 'string' && rawAmount.trim() === '') ||
      !amountBn.isFinite() ||
      amountBn.lt(MIN_STAKE) ||
      amountBn.gt(MAX_STAKE)
    ) {
      return this.rejectOrder(userId, dto, 'BAD_AMOUNT');
    }
    const amountStr = amountBn.toString();

    // 2. Ticker check
    const ticker = dto?.marketId;
    if (
      !ALLOWED_TICKERS.has(ticker) ||
      !dto?.cell ||
      dto.cell.ticker !== ticker
    ) {
      return this.rejectOrder(userId, dto, 'BAD_TICKER');
    }

    const now = Date.now();

    // 3. Quote freshness check
    if (
      !Number.isFinite(dto.cell.gridTs) ||
      now - dto.cell.gridTs > QUOTE_FRESHNESS_MS
    ) {
      return this.rejectOrder(userId, dto, 'STALE_QUOTE');
    }

    // 4. Window lead time check
    if (
      !Number.isFinite(dto.cell.startTs) ||
      !Number.isFinite(dto.cell.endTs) ||
      dto.cell.endTs <= dto.cell.startTs ||
      dto.cell.startTs < now + WINDOW_LEAD_TIME_MS
    ) {
      return this.rejectOrder(userId, dto, 'WINDOW_CLOSING');
    }

    // 5. Cell signature check
    if (!verifyCell(dto.cell, this.getCellSignerKey())) {
      return this.rejectOrder(userId, dto, 'BAD_SIGNATURE');
    }

    // 6. Feed health check
    if (this.feedHealthStore.isStale(ticker)) {
      return this.rejectOrder(userId, dto, 'FEED_PAUSED');
    }

    // 7. Rate limit check
    let rateLimiter = this.rateLimiters.get(userId);
    if (!rateLimiter) {
      rateLimiter = new TokenBucket({
        capacity: 20,
        refillRatePerSecond: 5,
      });
      this.rateLimiters.set(userId, rateLimiter);
    }

    const canPlace = await rateLimiter.consume(1);
    if (!canPlace) {
      return this.rejectOrder(userId, dto, 'RATE_LIMITED');
    }

    // 8. Per-cell stake limit check
    const cellId = getCellId(dto.cell);
    const clientTapId = sanitizeClientTapId(dto?.clientTapId);
    const currentStake = this.userCellStake.get(userId)?.get(cellId) ?? 0;
    if (new BigNumber(currentStake).plus(amountBn).gt(MAX_CELL_STAKE)) {
      return this.rejectOrder(userId, dto, 'CELL_LIMIT');
    }

    const orderId = `${userId}:${cellId}:${uuidv7()}`;

    // Optimistic lock before calling ledger to prevent concurrent over-cap
    this.adjustUserCellStake(userId, cellId, amountBn);

    // 9. Ledger debit
    try {
      await this.accountService.placeBet(userId, amountStr, ticker, orderId);
    } catch (error) {
      this.adjustUserCellStake(userId, cellId, amountBn.negated());
      const msg = error instanceof Error ? error.message : String(error);
      if (
        error instanceof BadRequestException ||
        msg.toLowerCase().includes('insufficient balance')
      ) {
        return this.rejectOrder(userId, dto, 'INSUFFICIENT_BALANCE', msg);
      }
      await this.events.emitOrderUpdate({
        orderId,
        userId,
        marketId: ticker,
        ticker,
        cellId,
        ...(clientTapId !== undefined ? { clientTapId } : {}),
        amount: amountStr,
        cell: dto.cell,
        status: OrderStatus.REJECTED,
      });
      throw error;
    }

    const order: Order = {
      orderId,
      userId,
      marketId: ticker,
      ticker,
      cellTimeStart: dto.cell.startTs,
      cellTimeEnd: dto.cell.endTs,
      lowerPrice: dto.cell.lowerPrice,
      upperPrice: dto.cell.upperPrice,
      amount: amountStr,
      rewardRate: dto.cell.rewardRate,
      placedAt: now,
      status: OrderStatus.OPEN,
    };

    const bucketKey = this.getBucketKey(ticker, dto.cell.startTs);
    let bucket = this.activeOrdersByBucket.get(bucketKey);
    if (!bucket) {
      bucket = new Map();
      this.activeOrdersByBucket.set(bucketKey, bucket);
    }
    bucket.set(orderId, order);

    try {
      const dbRecord = this.orderRepository.create(order);
      await this.orderRepository.save(dbRecord);
    } catch (error) {
      this.cleanupActiveOrder(order);
      await this.events.emitOrderUpdate({
        orderId,
        userId,
        marketId: ticker,
        ticker,
        cellId,
        ...(clientTapId !== undefined ? { clientTapId } : {}),
        amount: amountStr,
        cell: dto.cell,
        status: OrderStatus.REJECTED,
      });
      throw error;
    }

    this.exposureTracker.add(order);
    this.engineClient.sendExposure(
      ticker,
      this.exposureTracker.snapshot(ticker),
    );

    await this.events.emitOrderUpdate({
      orderId,
      userId,
      marketId: ticker,
      ticker,
      cellId,
      ...(clientTapId !== undefined ? { clientTapId } : {}),
      amount: amountStr,
      cell: dto.cell,
      status: OrderStatus.OPEN,
    });

    this.logger.log(`Order placed: ${orderId}`);
    return order;
  }

  async handleSample(sample: EngineSample): Promise<void> {
    return this.runSerializedForTicker(sample.ticker, async () => {
      const ticker = sample.ticker;
      const prevTs = this.lastSampleTsByTicker.get(ticker);
      const isOutOfOrder = prevTs !== undefined && sample.tsMs < prevTs;
      const hasGapVoid =
        prevTs !== undefined &&
        sample.tsMs > prevTs &&
        sample.tsMs - prevTs > VOID_GAP_MS;
      const staleIntervals = this.feedHealthStore.staleIntervals(
        ticker,
        sample.tsMs,
      );
      const sampleCents = Math.round(sample.price * 100);
      const prevCents =
        hasGapVoid || isOutOfOrder
          ? undefined
          : this.lastPriceCentsByTicker.get(ticker);

      const prefix = `${ticker}:`;
      const candidateOrders: Order[] = [];
      for (const [bucketKey, bucket] of this.activeOrdersByBucket) {
        if (bucketKey.startsWith(prefix)) {
          for (const order of bucket.values()) {
            candidateOrders.push(order);
          }
        }
      }

      const settlePromises: Promise<void>[] = [];
      const settled: SettledOrder[] = [];

      for (const order of candidateOrders) {
        const voidByGap =
          hasGapVoid &&
          intervalOverlapsWindow(
            prevTs!,
            sample.tsMs,
            order.cellTimeStart,
            order.cellTimeEnd,
          );
        const voidByStale = staleIntervals.some(([from, to]) =>
          intervalOverlapsWindow(
            from,
            to,
            order.cellTimeStart,
            order.cellTimeEnd,
          ),
        );

        if (voidByGap || voidByStale) {
          settlePromises.push(this.voidOrder(order, sample.tsMs));
          continue;
        }

        if (
          sample.tsMs >= order.cellTimeStart &&
          sample.tsMs < order.cellTimeEnd
        ) {
          const lowerCents = priceToCents(order.lowerPrice);
          const upperCents = priceToCents(order.upperPrice);
          if (
            segmentTouchesBand(prevCents, sampleCents, lowerCents, upperCents)
          ) {
            settled.push({ order, win: true, ts: sample.tsMs });
            settlePromises.push(this.settleOrder(order, sample.tsMs, true));
          }
        } else if (sample.tsMs >= order.cellTimeEnd) {
          settled.push({ order, win: false, ts: sample.tsMs });
          settlePromises.push(this.settleOrder(order, sample.tsMs, false));
        }
      }

      await Promise.all(settlePromises);
      for (const entry of buildFeedEntries(settled, env.botWallets)) {
        await this.events.emitTradeFeed?.(entry);
      }

      if (!isOutOfOrder) {
        this.lastSampleTsByTicker.set(ticker, sample.tsMs);
        this.lastPriceCentsByTicker.set(ticker, sampleCents);
      }
    });
  }

  async voidStaleOrders(nowMs: number = Date.now()): Promise<void> {
    const tickers = new Set<string>();
    for (const bucket of this.activeOrdersByBucket.values()) {
      for (const order of bucket.values()) {
        tickers.add(order.ticker || order.marketId);
      }
    }

    for (const ticker of tickers) {
      await this.runSerializedForTicker(ticker, async () => {
        const staleIntervals = this.feedHealthStore.staleIntervals(
          ticker,
          nowMs,
        );
        if (staleIntervals.length === 0) {
          return;
        }
        const prefix = `${ticker}:`;
        const ordersToVoid: Order[] = [];
        for (const [bucketKey, bucket] of this.activeOrdersByBucket) {
          if (!bucketKey.startsWith(prefix)) {
            continue;
          }
          for (const order of bucket.values()) {
            const overlaps = staleIntervals.some(([from, to]) =>
              intervalOverlapsWindow(
                from,
                to,
                order.cellTimeStart,
                order.cellTimeEnd,
              ),
            );
            if (overlaps) {
              ordersToVoid.push(order);
            }
          }
        }
        await Promise.all(
          ordersToVoid.map((order) => this.voidOrder(order, nowMs)),
        );
      });
    }
  }

  async settleOrder(
    order: Order,
    settledTs: number,
    win: boolean,
  ): Promise<void> {
    if (
      order.status === OrderStatus.SETTLED ||
      order.status === OrderStatus.VOIDED
    ) {
      this.logger.warn(`Order already finalized: ${order.orderId}`);
      return;
    }

    const cell = buildCellFromOrder(order);
    const cellId = getCellId(cell);
    const ticker = order.ticker || order.marketId;

    await this.accountService.settleBet(
      order.userId,
      order.amount,
      win,
      order.rewardRate,
      order.marketId,
      order.orderId,
    );

    order.status = OrderStatus.SETTLED;
    order.settledAt = settledTs;
    order.settledWin = win;

    this.cleanupActiveOrder(order);
    this.exposureTracker.remove(order);
    this.engineClient.sendExposure(
      ticker,
      this.exposureTracker.snapshot(ticker),
    );

    const wsMsg: OrderUpdateMessage = {
      orderId: order.orderId,
      userId: order.userId,
      marketId: order.marketId,
      ticker,
      cellId,
      cell,
      status: OrderStatus.SETTLED,
      amount: order.amount,
      settledWin: win,
      settledTimestamp: settledTs,
    };
    await this.events.emitOrderUpdate(wsMsg);

    await this.orderRepository.save(order);
    this.logger.log(`Order settled: ${order.orderId}, Win: ${win}`);
  }

  async voidOrder(order: Order, voidedTs: number): Promise<void> {
    if (
      order.status === OrderStatus.SETTLED ||
      order.status === OrderStatus.VOIDED
    ) {
      this.logger.warn(`Order already finalized: ${order.orderId}`);
      return;
    }

    const cell = buildCellFromOrder(order);
    const cellId = getCellId(cell);
    const ticker = order.ticker || order.marketId;

    await this.accountService.voidBet(
      order.userId,
      order.amount,
      order.marketId,
      order.orderId,
    );

    order.status = OrderStatus.VOIDED;
    order.settledAt = voidedTs;
    order.settledWin = undefined;

    this.cleanupActiveOrder(order);
    this.exposureTracker.remove(order);
    this.engineClient.sendExposure(
      ticker,
      this.exposureTracker.snapshot(ticker),
    );

    const wsMsg: OrderUpdateMessage = {
      orderId: order.orderId,
      userId: order.userId,
      marketId: order.marketId,
      ticker,
      cellId,
      cell,
      status: OrderStatus.VOIDED,
      amount: order.amount,
      settledTimestamp: voidedTs,
    };
    await this.events.emitOrderUpdate(wsMsg);

    await this.orderRepository.save(order);
    this.logger.log(`Order voided: ${order.orderId}`);
  }

  private cleanupActiveOrder(order: Order): void {
    const cellId = getCellId(buildCellFromOrder(order));
    const ticker = order.ticker || order.marketId;

    this.adjustUserCellStake(
      order.userId,
      cellId,
      new BigNumber(order.amount).negated(),
    );

    const bucketKey = this.getBucketKey(ticker, order.cellTimeStart);
    const bucket = this.activeOrdersByBucket.get(bucketKey);
    if (bucket) {
      bucket.delete(order.orderId);
      if (bucket.size === 0) {
        this.activeOrdersByBucket.delete(bucketKey);
      }
    }
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    return this.orderRepository.findOneBy({ orderId });
  }

  async getPeristedActiveOrders(): Promise<Order[]> {
    return this.orderRepository.find({
      where: {
        status: OrderStatus.OPEN,
      },
    });
  }

  async getUserOrders(
    userId: string,
    status?: OrderStatus,
    limit: number = 20,
    offset: number = 0,
    ticker?: string,
  ): Promise<Order[]> {
    const where: any = { userId };
    if (status) {
      where.status = status;
    }
    if (ticker) {
      where.ticker = ticker;
    }
    return this.orderRepository.find({
      where,
      take: limit,
      skip: offset,
      order: {
        placedAt: 'DESC',
      },
    });
  }
}
