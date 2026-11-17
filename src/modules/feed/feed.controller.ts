import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { env } from 'src/config';
import { Order } from '../order/entities/order.entity';
import { OrderStatus } from '../order/types';
import { buildFeedEntries, TradeFeedEntry } from './feed-entries';
import { PublicRateLimitGuard } from './public-rate-limit.guard';

@Controller('feed')
@UseGuards(PublicRateLimitGuard)
export class FeedController {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
  ) {}
  @Get('recent')
  async recent(@Query('limit') raw?: string): Promise<TradeFeedEntry[]> {
    if (
      raw !== undefined &&
      (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100)
    )
      throw new BadRequestException('Invalid limit');
    const limit = raw === undefined ? 30 : Number(raw);
    const orders = await this.orders.find({
      where: { status: OrderStatus.SETTLED },
      order: { settledAt: 'DESC' },
      take: 300,
    });
    return buildFeedEntries(
      orders
        .filter((order) => order.settledAt != null && order.settledWin != null)
        .map((order) => ({
          order,
          win: order.settledWin!,
          ts: order.settledAt!,
        })),
      env.botWallets,
    )
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }
}
