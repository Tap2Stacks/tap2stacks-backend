import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import BigNumber from 'bignumber.js';
import { Between, Repository } from 'typeorm';
import { isSupportedTicker, resolvePriceSourceLabel } from 'src/libs/tickers';
import { FeedHealthStore } from '../engine/feed-health.store';
import { PriceSample } from '../engine/price-sample.entity';
import { PublicRateLimitGuard } from '../feed/public-rate-limit.guard';

@Controller('prices')
@UseGuards(PublicRateLimitGuard)
export class PricesController {
  constructor(
    @InjectRepository(PriceSample)
    private readonly samples: Repository<PriceSample>,
    private readonly health: FeedHealthStore,
  ) {}
  @Get('recent')
  async recent(
    @Query('ticker') ticker: string,
    @Query('sinceMs') raw?: string,
  ) {
    if (!isSupportedTicker(ticker))
      throw new BadRequestException('Invalid ticker');
    if (raw !== undefined && (!raw.trim() || !Number.isFinite(Number(raw))))
      throw new BadRequestException('Invalid sinceMs');
    const now = Date.now();
    const since = Math.max(
      now - 60000,
      Math.min(now, raw === undefined ? now - 60000 : Number(raw)),
    );
    const samples = await this.samples.find({
      where: { ticker, tsMs: Between(since, now) },
      order: { tsMs: 'DESC' },
      take: 600,
    });
    return {
      ticker,
      source: resolvePriceSourceLabel(process.env.ENGINE_PRICE_SOURCE),
      prevDayPx: this.health.prevDayPx(ticker),
      points: samples
        .map((sample) => ({
          ts: sample.tsMs,
          price: new BigNumber(sample.price).toFixed(2),
        }))
        .sort((a, b) => a.ts - b.ts),
    };
  }
}
